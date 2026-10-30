"""Durable delivery contract independent of the outbox storage engine."""

from dataclasses import dataclass
from typing import Literal, Protocol

from .playtime import PendingPlaytime, PlaytimeRequest, RecordPlaytimeSession

DeliveryState = Literal["pending", "in_flight", "held", "completed"]


class PlaytimeStorageError(RuntimeError):
    """The outbox cannot be safely read or persisted."""


@dataclass(frozen=True, slots=True)
class BoundPlaytime:
    """A pinned interval and its durable delivery disposition."""

    app_id: int
    request: PlaytimeRequest
    state: DeliveryState


@dataclass(frozen=True, slots=True)
class PlaytimeBatch:
    """One immutable additive request marked durable before dispatch."""

    id: int
    sessions: list[RecordPlaytimeSession]


class PlaytimeOutbox(Protocol):
    """Atomic local transitions; a claimed batch is unsafe until explicitly settled."""

    def enqueue(
        self, steam_id: str, app_id: int, started_at: int, ended_at: int
    ) -> bool:
        """Insert an interval only if its permanent composite identity is new."""
        ...

    def pending(self, steam_id: str) -> list[PendingPlaytime]:
        """Read retryable intervals; raise on storage failure rather than return []."""
        ...

    def bind(
        self, steam_id: str, app_id: int, request: PlaytimeRequest
    ) -> BoundPlaytime:
        """Pin identity and allocate UTC-day carry and batches in one transaction."""
        ...

    def claim(
        self, steam_id: str, app_id: int, request: PlaytimeRequest
    ) -> PlaytimeBatch | DeliveryState:
        """Mark one bounded batch in-flight before returning it to a sender."""
        ...

    def acknowledge(self, batch_id: int) -> bool:
        """Remove an accepted batch; return whether its interval is now complete."""
        ...

    def release(self, batch_id: int) -> None:
        """Make a definitely rejected batch retryable."""
        ...

    def hold(self, batch_id: int) -> None:
        """Retain an uncertain outcome outside automatic retry."""
        ...
