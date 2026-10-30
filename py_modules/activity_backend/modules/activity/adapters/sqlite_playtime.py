"""SQLite transactional outbox for additive PlayTime delivery."""

from __future__ import annotations

import sqlite3
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from pathlib import Path

from ..playtime import PendingPlaytime, PlaytimeRequest, iter_utc_days
from ..playtime_outbox import (
    BoundPlaytime,
    DeliveryState,
    PlaytimeBatch,
    PlaytimeStorageError,
)
from .playtime_database import PlaytimeDatabase

_PendingRow = tuple[int, int, int, str | None, str | None, str | None]
_BoundRow = tuple[int, str | None, str | None, str | None, DeliveryState]
_ClaimRow = tuple[int, DeliveryState]
_BatchIdRow = tuple[int]
_IntervalIdRow = tuple[int]
_CarryRow = tuple[int]
_BatchSessionRow = tuple[str, int]


class SQLitePlaytimeOutbox:
    """Own interval identity, carry, batching, and delivery state in SQLite."""

    def __init__(self, path: Path) -> None:
        self._database: PlaytimeDatabase = PlaytimeDatabase(path)

    def enqueue(
        self, steam_id: str, app_id: int, started_at: int, ended_at: int
    ) -> bool:
        """Insert an interval once, retaining completed identities indefinitely."""
        with self._database.transaction() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO intervals
                    (steam_id, app_id, started_at, ended_at, state)
                VALUES (?, ?, ?, ?, 'pending')
                """,
                (steam_id, app_id, started_at, ended_at),
            )
            return cursor.rowcount == 1

    def pending(self, steam_id: str) -> list[PendingPlaytime]:
        """Return user-retryable intervals, never uncertain deliveries."""
        try:
            with self._database.connection() as connection:
                rows = cast(
                    "list[_PendingRow]",
                    connection.execute(
                        """
                        SELECT app_id, started_at, ended_at, game_id, release_id,
                               release_revision_id
                        FROM intervals
                        WHERE steam_id = ? AND state = 'pending'
                        ORDER BY id
                        """,
                        (steam_id,),
                    ).fetchall(),
                )
        except sqlite3.Error as error:
            raise PlaytimeStorageError("Could not read PlayTime outbox") from error

        entries: list[PendingPlaytime] = []
        for app_id, started_at, ended_at, game_id, release_id, revision_id in rows:
            entry: PendingPlaytime = {
                "appId": app_id,
                "startedAt": started_at,
                "endedAt": ended_at,
            }
            if game_id is not None:
                if release_id is None or revision_id is None:
                    raise PlaytimeStorageError(
                        "PlayTime outbox contains an incomplete identity"
                    )
                entry.update(
                    {
                        "gameId": game_id,
                        "releaseId": release_id,
                        "releaseRevisionId": revision_id,
                    }
                )
            entries.append(entry)
        return entries

    def bind(
        self, steam_id: str, app_id: int, request: PlaytimeRequest
    ) -> BoundPlaytime:
        """Pin a release identity and allocate its sessions exactly once."""
        with self._database.transaction() as connection:
            row = cast(
                "_BoundRow | None",
                connection.execute(
                    """
                    SELECT id, game_id, release_id, release_revision_id, state
                    FROM intervals
                    WHERE steam_id = ? AND app_id = ? AND started_at = ?
                      AND ended_at = ?
                    """,
                    (steam_id, app_id, request["started_at"], request["ended_at"]),
                ).fetchone(),
            )
            if row is None:
                cursor = connection.execute(
                    """
                    INSERT INTO intervals
                        (steam_id, app_id, started_at, ended_at, state)
                    VALUES (?, ?, ?, ?, 'pending')
                    """,
                    (steam_id, app_id, request["started_at"], request["ended_at"]),
                )
                interval_id = _identifier(cast("object", cursor.lastrowid), "interval")
                state: DeliveryState = "pending"
                identity: tuple[str | None, str | None, str | None] = (None, None, None)
            else:
                interval_id, game_id, release_id, revision_id, state = row
                identity = (game_id, release_id, revision_id)

            if identity[0] is not None:
                return BoundPlaytime(
                    app_id,
                    _request(
                        identity[0],
                        identity[1],
                        identity[2],
                        request["started_at"],
                        request["ended_at"],
                    ),
                    state,
                )

            _ = connection.execute(
                """
                UPDATE intervals
                SET game_id = ?, release_id = ?, release_revision_id = ?
                WHERE id = ?
                """,
                (
                    request["game_id"],
                    request["release_id"],
                    request["release_revision_id"],
                    interval_id,
                ),
            )
            has_sessions = self._allocate_batches(
                connection, interval_id, steam_id, request
            )
            state = "pending" if has_sessions else "completed"
            _ = connection.execute(
                "UPDATE intervals SET state = ? WHERE id = ?", (state, interval_id)
            )
            return BoundPlaytime(app_id, request, state)

    def claim(
        self, steam_id: str, app_id: int, request: PlaytimeRequest
    ) -> PlaytimeBatch | DeliveryState:
        """Durably mark the next bounded batch in-flight before network dispatch."""
        with self._database.transaction() as connection:
            row = cast(
                "_ClaimRow | None",
                connection.execute(
                    """
                    SELECT id, state FROM intervals
                    WHERE steam_id = ? AND app_id = ? AND started_at = ?
                      AND ended_at = ?
                    """,
                    (steam_id, app_id, request["started_at"], request["ended_at"]),
                ).fetchone(),
            )
            if row is None:
                return "completed"
            interval_id, state = row
            if state != "pending":
                return state

            batch = cast(
                "_BatchIdRow | None",
                connection.execute(
                    """
                    SELECT id FROM batches WHERE interval_id = ? AND state = 'pending'
                    ORDER BY id LIMIT 1
                    """,
                    (interval_id,),
                ).fetchone(),
            )
            if batch is None:
                _ = connection.execute(
                    "UPDATE intervals SET state = 'completed' WHERE id = ?",
                    (interval_id,),
                )
                return "completed"

            batch_id = batch[0]
            _ = connection.execute(
                "UPDATE batches SET state = 'in_flight' WHERE id = ?", (batch_id,)
            )
            _ = connection.execute(
                "UPDATE intervals SET state = 'in_flight' WHERE id = ?", (interval_id,)
            )
            rows = cast(
                "list[_BatchSessionRow]",
                connection.execute(
                    """
                    SELECT date, seconds FROM batch_sessions
                    WHERE batch_id = ? ORDER BY ordinal
                    """,
                    (batch_id,),
                ).fetchall(),
            )
            return PlaytimeBatch(
                batch_id,
                [
                    {
                        "date": date,
                        "gameId": request["game_id"],
                        "releaseId": request["release_id"],
                        "releaseVersionId": request["release_revision_id"],
                        "seconds": seconds,
                    }
                    for date, seconds in rows
                ],
            )

    def acknowledge(self, batch_id: int) -> bool:
        """Remove an accepted batch and return whether its interval is complete."""
        with self._database.transaction() as connection:
            row = cast(
                "_IntervalIdRow | None",
                connection.execute(
                    "SELECT interval_id FROM batches WHERE id = ?", (batch_id,)
                ).fetchone(),
            )
            if row is None:
                return True
            interval_id = row[0]
            _ = connection.execute("DELETE FROM batches WHERE id = ?", (batch_id,))
            remaining = cast(
                "_BatchIdRow | None",
                connection.execute(
                    "SELECT id FROM batches WHERE interval_id = ? LIMIT 1",
                    (interval_id,),
                ).fetchone(),
            )
            completed = remaining is None
            _ = connection.execute(
                "UPDATE intervals SET state = ? WHERE id = ?",
                ("completed" if completed else "pending", interval_id),
            )
            return completed

    def release(self, batch_id: int) -> None:
        """Return a definitely rejected batch to the retryable pending state."""
        with self._database.transaction() as connection:
            row = cast(
                "_IntervalIdRow | None",
                connection.execute(
                    "SELECT interval_id FROM batches WHERE id = ?", (batch_id,)
                ).fetchone(),
            )
            if row is None:
                return
            _ = connection.execute(
                "UPDATE batches SET state = 'pending' WHERE id = ?", (batch_id,)
            )
            _ = connection.execute(
                "UPDATE intervals SET state = 'pending' WHERE id = ?", (row[0],)
            )

    def hold(self, batch_id: int) -> None:
        """Persist an indeterminate delivery, which must never auto-retry."""
        with self._database.transaction() as connection:
            row = cast(
                "_IntervalIdRow | None",
                connection.execute(
                    "SELECT interval_id FROM batches WHERE id = ?", (batch_id,)
                ).fetchone(),
            )
            if row is None:
                return
            _ = connection.execute(
                "UPDATE batches SET state = 'held' WHERE id = ?", (batch_id,)
            )
            _ = connection.execute(
                "UPDATE intervals SET state = 'held' WHERE id = ?", (row[0],)
            )

    @staticmethod
    def _allocate_batches(
        connection: sqlite3.Connection,
        interval_id: int,
        steam_id: str,
        request: PlaytimeRequest,
    ) -> bool:
        """Allocate carry and write immutable batches in the binding transaction."""
        batch_id: int | None = None
        ordinal = 0
        wrote_session = False
        for day, milliseconds in iter_utc_days(
            request["started_at"], request["ended_at"]
        ):
            row = cast(
                "_CarryRow | None",
                connection.execute(
                    """
                    SELECT milliseconds FROM carries
                    WHERE steam_id = ? AND game_id = ? AND release_id = ?
                      AND release_revision_id = ? AND date = ?
                    """,
                    (
                        steam_id,
                        request["game_id"],
                        request["release_id"],
                        request["release_revision_id"],
                        day,
                    ),
                ).fetchone(),
            )
            seconds, carry = divmod(
                (row[0] if row is not None else 0) + milliseconds, 1000
            )
            _ = connection.execute(
                """
                INSERT INTO carries
                    (
                        steam_id,
                        game_id,
                        release_id,
                        release_revision_id,
                        date,
                        milliseconds
                    )
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(steam_id, game_id, release_id, release_revision_id, date)
                DO UPDATE SET milliseconds = excluded.milliseconds
                """,
                (
                    steam_id,
                    request["game_id"],
                    request["release_id"],
                    request["release_revision_id"],
                    day,
                    carry,
                ),
            )
            if seconds == 0:
                continue
            if batch_id is None or ordinal == 1000:
                cursor = connection.execute(
                    "INSERT INTO batches (interval_id, state) VALUES (?, 'pending')",
                    (interval_id,),
                )
                batch_id = _identifier(cast("object", cursor.lastrowid), "batch")
                ordinal = 0
            _ = connection.execute(
                (
                    "INSERT INTO batch_sessions "
                    "(batch_id, ordinal, date, seconds) VALUES (?, ?, ?, ?)"
                ),
                (batch_id, ordinal, day, seconds),
            )
            ordinal += 1
            wrote_session = True
        return wrote_session


def _identifier(value: object, kind: str) -> int:
    """Narrow a SQLite generated identifier to the expected persisted shape."""
    if isinstance(value, int):
        return value
    raise PlaytimeStorageError(f"PlayTime outbox did not create a {kind} identifier")


def _request(
    game_id: str,
    release_id: str | None,
    release_revision_id: str | None,
    started_at: int,
    ended_at: int,
) -> PlaytimeRequest:
    """Reconstruct a validated persisted identity."""
    if release_id is None or release_revision_id is None:
        raise PlaytimeStorageError("PlayTime outbox contains an incomplete identity")
    return {
        "game_id": game_id,
        "release_id": release_id,
        "release_revision_id": release_revision_id,
        "started_at": started_at,
        "ended_at": ended_at,
    }


__all__ = ["SQLitePlaytimeOutbox"]
