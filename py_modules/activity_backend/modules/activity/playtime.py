"""Validated PlayTime intervals and UTC-day allocation primitives."""

from __future__ import annotations

from datetime import date, timedelta
from typing import TYPE_CHECKING, NotRequired, TypedDict

if TYPE_CHECKING:
    from collections.abc import Iterator

from activity_backend.identifiers import is_uuid

MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
_MAX_SAFE_INTEGER = (1 << 53) - 1
_MIN_SAFE_INTEGER = -_MAX_SAFE_INTEGER
_EPOCH_DATE = date(1970, 1, 1)


class PlaytimeRequest(TypedDict):
    """Validated release-version interval expressed as exact epoch milliseconds."""

    game_id: str
    release_id: str
    release_revision_id: str
    started_at: int
    ended_at: int


class PendingPlaytime(TypedDict):
    """A committed PlayTime interval, optionally bound to one release revision."""

    appId: int
    startedAt: int
    endedAt: int
    gameId: NotRequired[str]
    releaseId: NotRequired[str]
    releaseRevisionId: NotRequired[str]


class RecordPlaytimeSession(TypedDict):
    """One whole-second, UTC-day contribution accepted by the additive endpoint."""

    date: str
    gameId: str
    releaseId: str
    releaseVersionId: str
    seconds: int


def valid_pending_playtime(
    app_id: object, started_at: object, ended_at: object
) -> PendingPlaytime | None:
    """Validate one exact committed Steam interval before durable delivery."""
    interval = _interval(started_at, ended_at)
    if (
        not isinstance(app_id, int)
        or isinstance(app_id, bool)
        or not 0 < app_id <= _MAX_SAFE_INTEGER
        or interval is None
    ):
        return None
    return {"appId": app_id, "startedAt": interval[0], "endedAt": interval[1]}


def valid_playtime_request(
    game_id: object,
    release_id: object,
    release_revision_id: object,
    started_at: object,
    ended_at: object,
) -> PlaytimeRequest | None:
    """Validate a release identity and exact JavaScript-safe millisecond interval."""
    interval = _interval(started_at, ended_at)
    if (
        not (is_uuid(game_id) and is_uuid(release_id) and is_uuid(release_revision_id))
        or interval is None
    ):
        return None
    return {
        "game_id": game_id,
        "release_id": release_id,
        "release_revision_id": release_revision_id,
        "started_at": interval[0],
        "ended_at": interval[1],
    }


def iter_utc_days(started_at: int, ended_at: int) -> Iterator[tuple[str, int]]:
    """Yield UTC-day contributions without materializing long intervals."""
    current = started_at
    while current < ended_at:
        day_number = current // MILLISECONDS_PER_DAY
        utc_day = _utc_day(day_number)
        if utc_day is None:
            raise ValueError(
                "Validated playtime timestamp has no representable UTC date"
            )
        next_midnight = (day_number + 1) * MILLISECONDS_PER_DAY
        duration = min(ended_at, next_midnight) - current
        yield utc_day, duration
        current += duration


def _interval(started_at: object, ended_at: object) -> tuple[int, int] | None:
    """Validate nondecreasing exact JavaScript-safe timestamps with UTC dates."""
    if not (_timestamp(started_at) and _timestamp(ended_at)):
        return None
    start = started_at
    end = ended_at
    if not isinstance(start, int) or not isinstance(end, int) or end < start:
        return None
    if _utc_day(start // MILLISECONDS_PER_DAY) is None:
        return None
    if end > start and _utc_day((end - 1) // MILLISECONDS_PER_DAY) is None:
        return None
    return start, end


def _timestamp(value: object) -> bool:
    """Accept only exact JavaScript-safe integer milliseconds."""
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and _MIN_SAFE_INTEGER <= value <= _MAX_SAFE_INTEGER
    )


def _utc_day(day_number: int) -> str | None:
    """Format one Unix-epoch day when it fits the wire format's date range."""
    try:
        return (_EPOCH_DATE + timedelta(days=day_number)).isoformat()
    except OverflowError:
        return None


__all__ = [
    "PendingPlaytime",
    "PlaytimeRequest",
    "RecordPlaytimeSession",
    "iter_utc_days",
    "valid_pending_playtime",
    "valid_playtime_request",
]
