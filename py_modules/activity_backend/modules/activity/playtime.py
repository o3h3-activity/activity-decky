"""Validated playtime intervals and their UTC-day allocation."""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import NotRequired, TypedDict

from .validation import is_uuid

MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
_EPOCH_DATE = date(1970, 1, 1)


class PlaytimeRequest(TypedDict):
    """Validated release-version interval expressed as epoch milliseconds."""

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


@dataclass(slots=True)
class PlaytimeWithdrawal:
    """A refused interval and the day totals that still need restoring."""

    status: int
    days: list[str]


@dataclass(slots=True)
class PlaytimeLedger:
    """Durable totals and exact interval identities for one release version."""

    days: dict[str, int] = field(default_factory=dict)
    intervals: set[tuple[int, int]] = field(default_factory=set)
    withdrawals: dict[tuple[int, int], PlaytimeWithdrawal] = field(default_factory=dict)

    def add(self, interval: tuple[int, int], days: dict[str, int]) -> bool:
        """Accumulate an interval's time once; returns whether the totals changed."""
        if interval in self.intervals:
            return False
        self.intervals.add(interval)
        for day, milliseconds in days.items():
            self.days[day] = self.days.get(day, 0) + milliseconds
        return True

    def withdraw(
        self,
        interval: tuple[int, int],
        days: dict[str, int],
        status: int,
    ) -> PlaytimeWithdrawal:
        """Remove a refused interval's time and remember every affected day to restore."""
        self.intervals.discard(interval)
        for day, milliseconds in days.items():
            remaining = self.days.get(day, 0) - milliseconds
            if remaining > 0:
                self.days[day] = remaining
            else:
                _ = self.days.pop(day, None)
        # Later intervals may already have uploaded these cumulative totals.
        withdrawal = PlaytimeWithdrawal(status, list(days))
        self.withdrawals[interval] = withdrawal
        return withdrawal


def valid_pending_playtime(
    app_id: object, started_at: object, ended_at: object
) -> PendingPlaytime | None:
    """Validate a committed interval before durable storage."""
    if not isinstance(app_id, int) or isinstance(app_id, bool) or app_id <= 0:
        return None
    interval = _interval(started_at, ended_at)
    if interval is None:
        return None
    return {"appId": app_id, "startedAt": interval[0], "endedAt": interval[1]}


def valid_playtime_request(
    game_id: object,
    release_id: object,
    release_revision_id: object,
    started_at: object,
    ended_at: object,
) -> PlaytimeRequest | None:
    """Validate identifiers and a finite, nondecreasing epoch-millisecond interval."""
    if not (is_uuid(game_id) and is_uuid(release_id) and is_uuid(release_revision_id)):
        return None
    interval = _interval(started_at, ended_at)
    if interval is None:
        return None
    return {
        "game_id": game_id,
        "release_id": release_id,
        "release_revision_id": release_revision_id,
        "started_at": interval[0],
        "ended_at": interval[1],
    }


def split_utc_days(started_at: int, ended_at: int) -> dict[str, int]:
    """Allocate the half-open interval across UTC dates in whole milliseconds."""
    days: dict[str, int] = {}
    current = started_at
    while current < ended_at:
        day_number = current // MILLISECONDS_PER_DAY
        day = _utc_day(day_number)
        if day is None:
            raise ValueError(
                "Validated playtime timestamp has no representable UTC date"
            )
        next_midnight = (day_number + 1) * MILLISECONDS_PER_DAY
        duration = min(ended_at, next_midnight) - current
        days[day] = duration
        current += duration
    return days


def _interval(started_at: object, ended_at: object) -> tuple[int, int] | None:
    """Validate a finite, nondecreasing interval whose UTC days are representable."""
    started = _timestamp(started_at)
    ended = _timestamp(ended_at)
    if started is None or ended is None or ended[0] < started[0]:
        return None
    started_milliseconds = started[1]
    ended_milliseconds = ended[1]
    if _utc_day(started_milliseconds // MILLISECONDS_PER_DAY) is None:
        return None
    if (
        ended_milliseconds > started_milliseconds
        and _utc_day((ended_milliseconds - 1) // MILLISECONDS_PER_DAY) is None
    ):
        return None
    return (started_milliseconds, ended_milliseconds)


def _timestamp(value: object) -> tuple[int | float, int] | None:
    """Validate a numeric timestamp and normalize it to a millisecond boundary."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return (value, value)
    if not isinstance(value, float) or not math.isfinite(value):
        return None
    return (value, math.floor(value))


def _utc_day(day_number: int) -> str | None:
    """Format one Unix-epoch day when it fits the wire format's date range."""
    try:
        return (_EPOCH_DATE + timedelta(days=day_number)).isoformat()
    except OverflowError:
        return None


__all__ = [
    "PendingPlaytime",
    "PlaytimeLedger",
    "PlaytimeRequest",
    "PlaytimeWithdrawal",
    "split_utc_days",
    "valid_pending_playtime",
    "valid_playtime_request",
]
