"""SQLite connection and schema lifetime for the PlayTime outbox."""

from __future__ import annotations

import os
import sqlite3
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import TYPE_CHECKING, cast

if TYPE_CHECKING:
    from collections.abc import Generator
    from typing import Final

from ..playtime_outbox import PlaytimeStorageError

_SCHEMA_TABLES: Final = frozenset({"intervals", "carries", "batches", "batch_sessions"})
_SCHEMA_STATEMENTS: Final = (
    """
    CREATE TABLE intervals (
        id INTEGER PRIMARY KEY,
        steam_id TEXT NOT NULL,
        app_id INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        game_id TEXT,
        release_id TEXT,
        release_revision_id TEXT,
        state TEXT NOT NULL
            CHECK(state IN ('pending', 'in_flight', 'held', 'completed')),
        UNIQUE(steam_id, app_id, started_at, ended_at),
        CHECK(
            (game_id IS NULL AND release_id IS NULL AND release_revision_id IS NULL)
            OR (
                game_id IS NOT NULL
                AND release_id IS NOT NULL
                AND release_revision_id IS NOT NULL
            )
        )
    )
    """,
    """
    CREATE TABLE carries (
        steam_id TEXT NOT NULL,
        game_id TEXT NOT NULL,
        release_id TEXT NOT NULL,
        release_revision_id TEXT NOT NULL,
        date TEXT NOT NULL,
        milliseconds INTEGER NOT NULL CHECK(milliseconds >= 0 AND milliseconds < 1000),
        PRIMARY KEY (steam_id, game_id, release_id, release_revision_id, date)
    )
    """,
    """
    CREATE TABLE batches (
        id INTEGER PRIMARY KEY,
        interval_id INTEGER NOT NULL REFERENCES intervals(id) ON DELETE CASCADE,
        state TEXT NOT NULL CHECK(state IN ('pending', 'in_flight', 'held'))
    )
    """,
    """
    CREATE TABLE batch_sessions (
        batch_id INTEGER NOT NULL REFERENCES batches(id) ON DELETE CASCADE,
        ordinal INTEGER NOT NULL,
        date TEXT NOT NULL,
        seconds INTEGER NOT NULL CHECK(seconds > 0),
        PRIMARY KEY (batch_id, ordinal)
    )
    """,
    "CREATE INDEX intervals_pending_by_account ON intervals(steam_id, state, id)",
    "CREATE INDEX batches_by_interval ON batches(interval_id, state, id)",
)


class PlaytimeDatabase:
    """Open only a validated outbox, and never recreate one after initialization."""

    def __init__(self, path: Path) -> None:
        self._path: Path = path
        self._creation_allowed: bool = True

    @contextmanager
    def connection(self) -> Generator[sqlite3.Connection, None, None]:
        """Yield a configured connection and always close it."""
        try:
            connection: sqlite3.Connection = self._open()
        except (OSError, sqlite3.Error) as error:
            raise PlaytimeStorageError("Could not open PlayTime outbox") from error

        try:
            yield connection
        finally:
            try:
                connection.close()
            except sqlite3.Error as error:
                raise PlaytimeStorageError("Could not close PlayTime outbox") from error

    @contextmanager
    def transaction(self) -> Generator[sqlite3.Connection, None, None]:
        """Yield a FULL-durability write transaction."""
        try:
            with self.connection() as connection:
                _ = connection.execute("BEGIN IMMEDIATE")
                try:
                    yield connection
                    connection.commit()
                except BaseException:
                    connection.rollback()
                    raise
                self._secure_sidecars()
        except (OSError, sqlite3.Error) as error:
            raise PlaytimeStorageError("Could not persist PlayTime outbox") from error

    def _open(self) -> sqlite3.Connection:
        if self._creation_allowed:
            if self._path_exists():
                self._creation_allowed = False
            else:
                self._publish_schema()

        if not self._creation_allowed:
            self._ensure_outbox_exists()

        connection: sqlite3.Connection | None = None
        initialized = False
        try:
            connection = sqlite3.connect(
                self._path.absolute().as_uri() + "?mode=rw",
                uri=True,
                timeout=5,
                isolation_level=None,
            )
            connection.execute("PRAGMA journal_mode = WAL").close()
            self._configure(connection)
            self._secure_sidecars()
            self._validate_schema(connection)
            initialized = True
            return connection
        finally:
            if not initialized and connection is not None:
                connection.close()

    def _path_exists(self) -> bool:
        """Return whether a final outbox is already present."""
        try:
            _ = self._path.stat()
        except FileNotFoundError:
            return False
        return True

    def _ensure_outbox_exists(self) -> None:
        """Reject an established outbox disappearing instead of recreating it."""
        try:
            size = self._path.stat().st_size
        except OSError as error:
            raise PlaytimeStorageError("PlayTime outbox disappeared") from error
        if size == 0:
            raise PlaytimeStorageError("PlayTime outbox is unexpectedly empty")

    def _publish_schema(self) -> None:
        """Build a complete private database, then atomically publish it once."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=f".{self._path.name}.",
            suffix=".tmp",
            dir=self._path.parent,
        )
        temporary_path = Path(temporary_name)
        connection: sqlite3.Connection | None = None
        try:
            try:
                os.fchmod(descriptor, 0o600)
            finally:
                os.close(descriptor)

            connection = sqlite3.connect(
                temporary_path.absolute().as_uri() + "?mode=rw",
                uri=True,
                timeout=5,
                isolation_level=None,
            )
            try:
                connection.execute("PRAGMA journal_mode = DELETE").close()
                self._configure(connection)
                self._create_schema(connection)
            finally:
                connection.close()
                connection = None

            os.chmod(temporary_path, 0o600)
            self._sync_file(temporary_path)
            try:
                os.link(temporary_path, self._path)
            except FileExistsError:
                self._creation_allowed = False
                return

            self._creation_allowed = False
            temporary_path.unlink()
            self._sync_directory()
        finally:
            if connection is not None:
                connection.close()
            temporary_path.unlink(missing_ok=True)

    @staticmethod
    def _configure(connection: sqlite3.Connection) -> None:
        """Apply durability settings before reading or writing an outbox."""
        _ = connection.execute("PRAGMA foreign_keys = ON")
        _ = connection.execute("PRAGMA synchronous = FULL")

    @staticmethod
    def _sync_file(path: Path) -> None:
        """Flush a completed temporary database before it receives a final name."""
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _sync_directory(self) -> None:
        """Persist the final-name link after publishing a complete database."""
        descriptor = os.open(self._path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def _create_schema(self, connection: sqlite3.Connection) -> None:
        """Create all schema objects as a single atomic first-use operation."""
        _ = connection.execute("BEGIN IMMEDIATE")
        try:
            for statement in _SCHEMA_STATEMENTS:
                _ = connection.execute(statement)
            connection.commit()
        except BaseException:
            connection.rollback()
            raise

    @staticmethod
    def _validate_schema(connection: sqlite3.Connection) -> None:
        rows = cast(
            "list[tuple[str]]",
            connection.execute(
                """
                SELECT name FROM sqlite_master
                WHERE type = 'table'
                  AND name IN ('intervals', 'carries', 'batches', 'batch_sessions')
                """
            ).fetchall(),
        )
        if frozenset(row[0] for row in rows) != _SCHEMA_TABLES:
            raise PlaytimeStorageError("PlayTime outbox schema is missing")

    def _secure_sidecars(self) -> None:
        """Keep SQLite's database and journal files private."""
        os.chmod(self._path, 0o600)
        for suffix in ("-journal", "-wal", "-shm"):
            sidecar = self._path.with_name(self._path.name + suffix)
            if sidecar.exists():
                os.chmod(sidecar, 0o600)
