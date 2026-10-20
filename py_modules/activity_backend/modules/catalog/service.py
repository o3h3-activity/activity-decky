"""Application service for authenticated catalog recognition."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import cast

from activity_backend.modules.authorization.api import Session

from .ports import RecognitionCache, RecognitionEndpoint
from .recognition import (
    GameIdentity,
    GameRecognition,
    RecognitionCacheEntry,
    cached_recognition,
    unique_identities,
)

MINIMUM_RETRY_SECONDS = 60


class GameRecognitionClient:
    """Resolve native disc hashes to Activity catalog release revisions."""

    def __init__(
        self,
        cache: RecognitionCache,
        endpoint: RecognitionEndpoint,
        session: Session,
        logger: logging.Logger,
        *,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        """Bind durable cache, endpoint, session, logging, and clock."""
        self._cache: RecognitionCache = cache
        self._endpoint: RecognitionEndpoint = endpoint
        self._session: Session = session
        self._logger: logging.Logger = logger
        self._wall_clock: Callable[[], float] = wall_clock
        self._blocked_until: float = 0.0

    async def recognize(self, identities: object) -> list[GameRecognition]:
        """Resolve each unique valid identity, omitting temporarily unresolved ones."""
        token = self._session.access_token()
        if token is None or not isinstance(identities, list):
            return []

        now = self._wall_clock()
        cache = self._cache.load()
        results: list[GameRecognition] = []
        unresolved: list[GameIdentity] = []
        for identity in unique_identities(cast(list[object], identities)):
            md5 = identity["game_identity_md5"]
            cached = cached_recognition(md5, cache.get(md5), now)
            if cached is not None:
                results.append(cached)
            elif identity["serial"] is not None and identity["serial"].strip():
                unresolved.append(identity)
        if now < self._blocked_until:
            return results

        for identity in unresolved:
            outcome, stop_batch = await self._recognize_one(identity, token)
            if self._session.access_token() != token:
                return []
            if outcome is not None:
                results.append(outcome)
                self._save_recognition(outcome, self._wall_clock())
            if stop_batch:
                break
        return results

    def _save_recognition(
        self, recognition: GameRecognition, checked_at: float
    ) -> None:
        cache = self._cache.load()
        entry = RecognitionCacheEntry(
            recognition["gameId"],
            recognition["releaseId"],
            recognition["releaseRevisionId"],
            checked_at=checked_at,
        )
        cache[recognition["gameIdentityMd5"]] = entry
        self._cache.save(cache)

    async def _recognize_one(
        self, identity: GameIdentity, token: str
    ) -> tuple[GameRecognition | None, bool]:
        response = await self._endpoint.recognize(identity, token)
        if response.kind == "unreachable":
            self._logger.error("Game recognition failed: unreachable")
            return None, False
        if response.kind == "unauthorized":
            await self._session.end_session(token)
            return None, True
        if response.kind == "invalidResponse":
            self._logger.error("Game recognition failed: invalid response")
            return None, False
        if response.kind == "rateLimited":
            delay = max(response.retry_after_seconds, MINIMUM_RETRY_SECONDS)
            self._blocked_until = self._wall_clock() + delay
            self._logger.warning("Game recognition blocked for %s seconds", delay)
            return None, True
        if response.kind == "unexpected":
            self._logger.error("Game recognition failed: HTTP %s", response.status)
            return None, False
        return (
            {
                "gameIdentityMd5": identity["game_identity_md5"],
                "gameId": response.game_id,
                "releaseId": response.release_id,
                "releaseRevisionId": response.release_revision_id,
            },
            False,
        )


__all__ = ["GameRecognitionClient"]
