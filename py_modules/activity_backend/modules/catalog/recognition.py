"""Pure catalog-recognition validation and cache-freshness rules."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal, TypedDict, cast

RECOGNITION_CACHE_SECONDS = 4 * 60 * 60
MD5_PATTERN = re.compile(r"[0-9a-fA-F]{32}")


class GameRecognition(TypedDict):
    """Catalog identity associated with one disc image hash."""

    gameIdentityMd5: str
    gameId: str | None
    releaseId: str | None
    releaseRevisionId: str | None


class GameIdentity(TypedDict):
    """Validated native disc identity mapped to a catalog recognition request."""

    game_identity_md5: str
    platform: Literal["ps1", "ps2", "psp"]
    serial: str | None


@dataclass(frozen=True, slots=True)
class RecognitionCacheEntry:
    """An immutable catalog answer retained across recognition requests."""

    game_id: str | None
    release_id: str | None
    release_revision_id: str | None
    checked_at: float | None = None

    @property
    def is_complete(self) -> bool:
        """Whether this entry identifies everything a comment needs."""
        return (
            self.game_id is not None
            and self.release_id is not None
            and self.release_revision_id is not None
        )


@dataclass(frozen=True, slots=True)
class CatalogAnswer:
    """A successful catalog response, including an explicit negative answer."""

    game_id: str | None
    release_id: str | None
    release_revision_id: str | None
    kind: Literal["catalogAnswer"] = field(default="catalogAnswer", init=False)


@dataclass(frozen=True, slots=True)
class UnreachableRecognitionError:
    """The catalog endpoint could not be reached."""

    kind: Literal["unreachable"] = field(default="unreachable", init=False)


@dataclass(frozen=True, slots=True)
class UnauthorizedRecognitionError:
    """The catalog endpoint rejected the current authorization token."""

    status: int
    kind: Literal["unauthorized"] = field(default="unauthorized", init=False)


@dataclass(frozen=True, slots=True)
class RateLimitedRecognitionError:
    """The catalog endpoint instructed the client to pause requests."""

    status: int
    retry_after_seconds: int
    kind: Literal["rateLimited"] = field(default="rateLimited", init=False)


@dataclass(frozen=True, slots=True)
class UnexpectedRecognitionError:
    """The catalog endpoint returned an unhandled HTTP status."""

    status: int
    kind: Literal["unexpected"] = field(default="unexpected", init=False)


@dataclass(frozen=True, slots=True)
class InvalidRecognitionResponse:
    """The catalog endpoint returned a malformed success payload."""

    kind: Literal["invalidResponse"] = field(default="invalidResponse", init=False)


RecognitionEndpointResult = (
    CatalogAnswer
    | UnreachableRecognitionError
    | UnauthorizedRecognitionError
    | RateLimitedRecognitionError
    | UnexpectedRecognitionError
    | InvalidRecognitionResponse
)


def valid_identity(value: object) -> GameIdentity | None:
    """Return a valid native identity, excluding malformed RPC input."""
    if not isinstance(value, dict):
        return None
    candidate = cast(dict[object, object], value)
    game_identity_md5 = candidate.get("game_identity_md5")
    platform = candidate.get("platform")
    serial = candidate.get("serial")
    if not (
        isinstance(game_identity_md5, str)
        and MD5_PATTERN.fullmatch(game_identity_md5)
        and platform in {"ps1", "ps2", "psp"}
        and (serial is None or isinstance(serial, str))
    ):
        return None
    return {
        "game_identity_md5": game_identity_md5,
        "platform": cast(Literal["ps1", "ps2", "psp"], platform),
        "serial": serial,
    }


def unique_identities(identities: list[object]) -> list[GameIdentity]:
    """Keep the first valid identity for each native content hash."""
    unique: list[GameIdentity] = []
    seen: set[str] = set()
    for raw_identity in identities:
        identity = valid_identity(raw_identity)
        if identity is None or identity["game_identity_md5"] in seen:
            continue
        seen.add(identity["game_identity_md5"])
        unique.append(identity)
    return unique


def cached_recognition(
    md5: str, entry: RecognitionCacheEntry | None, now: float
) -> GameRecognition | None:
    """Return a still-fresh typed cache entry for one game identity hash."""
    if (
        entry is None
        or entry.checked_at is None
        or now - entry.checked_at >= RECOGNITION_CACHE_SECONDS
    ):
        return None
    return {
        "gameIdentityMd5": md5,
        "gameId": entry.game_id,
        "releaseId": entry.release_id if entry.is_complete else None,
        "releaseRevisionId": entry.release_revision_id,
    }
