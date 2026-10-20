"""Settings and HTTP adapters for catalog recognition."""

from __future__ import annotations

import math
from dataclasses import replace
from typing import cast

from activity_backend.shared import ActivityTransport, Settings

from ..ports import RecognitionCache, RecognitionEndpoint
from ..recognition import (
    CatalogAnswer,
    GameIdentity,
    InvalidRecognitionResponse,
    RateLimitedRecognitionError,
    RecognitionCacheEntry,
    RecognitionEndpointResult,
    UnauthorizedRecognitionError,
    UnexpectedRecognitionError,
    UnreachableRecognitionError,
)

GAME_RECOGNITIONS_SETTING = "gameRecognitions"
GAME_RECOGNITION_PATH = "/api/v1/game-recognition"
CATALOG_PLATFORMS = {
    "ps1": "playstation",
    "ps2": "playstation-2",
    "psp": "playstation-portable",
}


class SettingsRecognitionCache(RecognitionCache):
    """Persist catalog answers in the module-owned settings mapping."""

    def __init__(self, settings: Settings) -> None:
        self._settings: Settings = settings

    def load(self) -> dict[str, RecognitionCacheEntry]:
        """Decode valid persisted cache entries into catalog-owned values."""
        raw_cache = self._settings.get(GAME_RECOGNITIONS_SETTING, object)
        if not isinstance(raw_cache, dict):
            return {}
        serialized_cache = cast(dict[object, object], raw_cache)
        cache: dict[str, RecognitionCacheEntry] = {}
        for md5, raw_entry in serialized_cache.items():
            if not isinstance(md5, str):
                continue
            entry = self._decode_entry(raw_entry)
            if entry is not None:
                cache[md5] = entry
        return cache

    def save(self, cache: dict[str, RecognitionCacheEntry]) -> None:
        """Encode cache entries under the original module-owned settings key."""
        self._settings.update(
            {
                GAME_RECOGNITIONS_SETTING: {
                    md5: self._encode_entry(entry) for md5, entry in cache.items()
                }
            }
        )

    @staticmethod
    def _decode_entry(value: object) -> RecognitionCacheEntry | None:
        """Decode one persisted entry, requiring a usable freshness timestamp."""
        if not isinstance(value, dict):
            return None
        serialized = cast(dict[object, object], value)
        game_id = serialized.get("gameId")
        release_id = serialized.get("releaseId")
        release_revision_id = serialized.get("releaseRevisionId")
        entry = RecognitionCacheEntry(
            game_id if isinstance(game_id, str) else None,
            release_id if isinstance(release_id, str) else None,
            release_revision_id if isinstance(release_revision_id, str) else None,
        )
        checked_at = serialized.get("checkedAt")
        if not isinstance(checked_at, (int, float)) or isinstance(checked_at, bool):
            return None
        try:
            decoded_checked_at = float(checked_at)
        except OverflowError:
            return None
        if not math.isfinite(decoded_checked_at):
            return None
        return replace(entry, checked_at=decoded_checked_at)

    @staticmethod
    def _encode_entry(entry: RecognitionCacheEntry) -> dict[str, object]:
        """Encode one typed cache entry with its established persistent schema."""
        serialized: dict[str, object] = {
            "gameId": entry.game_id,
            "releaseId": entry.release_id,
            "releaseRevisionId": entry.release_revision_id,
        }
        if entry.checked_at is not None:
            serialized["checkedAt"] = entry.checked_at
        return serialized


class ActivityCatalogEndpoint(RecognitionEndpoint):
    """Translate catalog recognition to Activity's HTTP API."""

    def __init__(self, transport: ActivityTransport) -> None:
        self._transport: ActivityTransport = transport

    async def recognize(
        self, identity: GameIdentity, token: str
    ) -> RecognitionEndpointResult:
        """Submit an identity and translate the endpoint response."""
        response = await self._transport.send(
            "POST",
            GAME_RECOGNITION_PATH,
            body={
                "hash": identity["game_identity_md5"].lower(),
                "platform": CATALOG_PLATFORMS[identity["platform"]],
                "serial": identity["serial"],
            },
            token=token,
        )
        if response is None:
            return UnreachableRecognitionError()
        if response.status == 401:
            return UnauthorizedRecognitionError(401)
        if response.status in {429, 503}:
            return RateLimitedRecognitionError(
                response.status, response.retry_after_seconds
            )
        if response.status == 404:
            return CatalogAnswer(None, None, None)
        if response.status != 200:
            return UnexpectedRecognitionError(response.status)
        return self._catalog_answer(response.body)

    @staticmethod
    def _catalog_answer(payload: object) -> CatalogAnswer | InvalidRecognitionResponse:
        if not isinstance(payload, dict):
            return InvalidRecognitionResponse()
        values = cast(dict[object, object], payload)
        game_id = values.get("gameId")
        release_id = values.get("releaseId")
        release_revision_id = values.get("releaseRevisionId")
        if not (
            isinstance(game_id, str)
            and game_id
            and isinstance(release_id, str)
            and release_id
            and isinstance(release_revision_id, str)
            and release_revision_id
        ):
            return InvalidRecognitionResponse()
        return CatalogAnswer(game_id, release_id, release_revision_id)


__all__ = ["ActivityCatalogEndpoint", "SettingsRecognitionCache"]
