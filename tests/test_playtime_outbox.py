"""Consumer-visible durability behavior of the SQLite PlayTime outbox."""

import sqlite3
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch

from backend_support import BackendTestCase

from activity_backend.modules.activity.adapters import playtime_database
from activity_backend.modules.activity.adapters.sqlite_playtime import (
    SQLitePlaytimeOutbox,
)
from activity_backend.modules.activity.playtime import PlaytimeRequest
from activity_backend.modules.activity.playtime_outbox import (
    PlaytimeBatch,
    PlaytimeStorageError,
)

STEAM_ID = "account-a"
GAME_ID = "a0b1c2d3-1234-4abc-8def-0123456789ab"
RELEASE_ID = "b0b1c2d3-1234-4abc-8def-0123456789ab"
REVISION_ID = "c0b1c2d3-1234-4abc-8def-0123456789ab"


class SQLitePlaytimeOutboxTests(BackendTestCase):
    """Exercise durable playtime state transitions."""

    def setUp(self) -> None:
        """Create an isolated durable outbox path."""
        super().setUp()
        self.outbox_path = self.path / "playtime.sqlite3"

    @staticmethod
    def _request(
        started_at: int, ended_at: int, revision_id: str = REVISION_ID
    ) -> PlaytimeRequest:
        return {
            "game_id": GAME_ID,
            "release_id": RELEASE_ID,
            "release_revision_id": revision_id,
            "started_at": started_at,
            "ended_at": ended_at,
        }

    def test_duplicate_history_survives_restart(self) -> None:
        """Retain acknowledged interval history across process restarts."""
        outbox = SQLitePlaytimeOutbox(self.outbox_path)
        for index in range(257):
            started_at = index * 1_000
            self.assertTrue(
                outbox.enqueue(STEAM_ID, 42, started_at, started_at + 1_000)
            )
            bound = outbox.bind(
                STEAM_ID, 42, self._request(started_at, started_at + 1_000)
            )
            claimed = outbox.claim(STEAM_ID, 42, bound.request)
            self.assertIsInstance(claimed, PlaytimeBatch)
            outbox.acknowledge(claimed.id)

        recreated = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertFalse(recreated.enqueue(STEAM_ID, 42, 0, 1_000))
        self.assertEqual(recreated.pending(STEAM_ID), [])

    def test_app_id_is_part_of_interval_identity(self) -> None:
        """Treat application identifiers as part of interval identity."""
        outbox = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertTrue(outbox.enqueue(STEAM_ID, 42, 0, 1_000))
        self.assertTrue(outbox.enqueue(STEAM_ID, 43, 0, 1_000))
        first = outbox.bind(STEAM_ID, 42, self._request(0, 1_000))
        second = outbox.bind(STEAM_ID, 43, self._request(0, 1_000))
        first_batch = outbox.claim(STEAM_ID, 42, first.request)
        second_batch = outbox.claim(STEAM_ID, 43, second.request)
        self.assertIsInstance(first_batch, PlaytimeBatch)
        self.assertIsInstance(second_batch, PlaytimeBatch)
        self.assertNotEqual(first_batch.id, second_batch.id)

    def test_carry_is_scoped_to_account_and_release(self) -> None:
        """Scope residual sub-second carry by account and release."""
        outbox = SQLitePlaytimeOutbox(self.outbox_path)
        for steam_id, app_id, revision_id in (
            (STEAM_ID, 42, REVISION_ID),
            ("account-b", 42, REVISION_ID),
            (STEAM_ID, 43, "d0b1c2d3-1234-4abc-8def-0123456789ab"),
        ):
            self.assertTrue(outbox.enqueue(steam_id, app_id, 0, 600))
            self.assertEqual(
                outbox.bind(steam_id, app_id, self._request(0, 600, revision_id)).state,
                "completed",
            )

        self.assertTrue(outbox.enqueue(STEAM_ID, 42, 1_000, 1_600))
        bound = outbox.bind(STEAM_ID, 42, self._request(1_000, 1_600))
        batch = outbox.claim(STEAM_ID, 42, bound.request)
        self.assertIsInstance(batch, PlaytimeBatch)
        self.assertEqual(batch.sessions[0]["seconds"], 1)

    def test_inflight_batch_is_not_returned_as_pending_after_restart(self) -> None:
        """Keep an in-flight batch out of pending work after restart."""
        outbox = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertTrue(outbox.enqueue(STEAM_ID, 42, 0, 1_000))
        bound = outbox.bind(STEAM_ID, 42, self._request(0, 1_000))
        self.assertIsInstance(outbox.claim(STEAM_ID, 42, bound.request), PlaytimeBatch)

        recreated = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertEqual(recreated.pending(STEAM_ID), [])
        self.assertEqual(recreated.claim(STEAM_ID, 42, bound.request), "in_flight")

    def test_batches_are_bounded_and_accepted_prefix_is_not_recreated(self) -> None:
        """Avoid recreating an accepted prefix when batches split."""
        day = 24 * 60 * 60 * 1_000
        outbox = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertTrue(outbox.enqueue(STEAM_ID, 42, 0, 1_001 * day))
        bound = outbox.bind(STEAM_ID, 42, self._request(0, 1_001 * day))
        first = outbox.claim(STEAM_ID, 42, bound.request)
        self.assertIsInstance(first, PlaytimeBatch)
        self.assertEqual(len(first.sessions), 1000)
        self.assertFalse(outbox.acknowledge(first.id))

        recreated = SQLitePlaytimeOutbox(self.outbox_path)
        second = recreated.claim(STEAM_ID, 42, bound.request)
        self.assertIsInstance(second, PlaytimeBatch)
        self.assertEqual(len(second.sessions), 1)
        recreated.release(second.id)
        retry = recreated.claim(STEAM_ID, 42, bound.request)
        self.assertIsInstance(retry, PlaytimeBatch)
        self.assertEqual(retry.sessions, second.sessions)
        self.assertTrue(recreated.acknowledge(retry.id))
        self.assertTrue(recreated.acknowledge(retry.id))

    def test_failed_bind_rolls_back_interval_and_carry(self) -> None:
        """Roll back interval and carry changes after a bind failure."""
        outbox = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertTrue(outbox.enqueue(STEAM_ID, 42, 0, 1_600))
        with sqlite3.connect(self.outbox_path) as connection:
            connection.execute(
                """
                CREATE TRIGGER reject_batch_session
                BEFORE INSERT ON batch_sessions
                BEGIN
                    SELECT RAISE(ABORT, 'simulated batch failure');
                END
                """
            )

        with self.assertRaises(PlaytimeStorageError):
            outbox.bind(STEAM_ID, 42, self._request(0, 1_600))

        with sqlite3.connect(self.outbox_path) as connection:
            connection.execute("DROP TRIGGER reject_batch_session")

        recreated = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertTrue(recreated.enqueue(STEAM_ID, 42, 2_000, 2_400))
        self.assertEqual(
            recreated.bind(STEAM_ID, 42, self._request(2_000, 2_400)).state,
            "completed",
        )
        failed_interval = recreated.bind(STEAM_ID, 42, self._request(0, 1_600))
        batch = recreated.claim(STEAM_ID, 42, failed_interval.request)
        self.assertIsInstance(batch, PlaytimeBatch)
        self.assertEqual(batch.sessions[0]["seconds"], 2)

    def test_failed_acknowledgement_leaves_batch_in_flight_after_restart(self) -> None:
        """Leave an unacknowledged batch in flight after restart."""
        outbox = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertTrue(outbox.enqueue(STEAM_ID, 42, 0, 1_000))
        bound = outbox.bind(STEAM_ID, 42, self._request(0, 1_000))
        batch = outbox.claim(STEAM_ID, 42, bound.request)
        self.assertIsInstance(batch, PlaytimeBatch)
        with sqlite3.connect(self.outbox_path) as connection:
            connection.execute(
                """
                CREATE TRIGGER reject_acknowledgement
                BEFORE DELETE ON batches
                BEGIN
                    SELECT RAISE(ABORT, 'simulated acknowledgement failure');
                END
                """
            )

        with self.assertRaises(PlaytimeStorageError):
            outbox.acknowledge(batch.id)

        recreated = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertEqual(recreated.claim(STEAM_ID, 42, bound.request), "in_flight")

    def test_corrupt_outbox_fails_closed(self) -> None:
        """Reject reads from a corrupt durable outbox."""
        outbox = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertTrue(outbox.enqueue(STEAM_ID, 42, 0, 1_000))
        for suffix in ("", "-wal", "-shm"):
            path = self.outbox_path.with_name(self.outbox_path.name + suffix)
            if suffix:
                path.unlink(missing_ok=True)
        self.outbox_path.write_bytes(b"not a sqlite database")

        with self.assertRaises(PlaytimeStorageError):
            SQLitePlaytimeOutbox(self.outbox_path).pending(STEAM_ID)

    def test_failed_schema_creation_retries_without_poisoning_outbox(self) -> None:
        """Allow schema creation to retry after an initial failure."""
        outbox = SQLitePlaytimeOutbox(self.outbox_path)

        with (
            patch.object(
                playtime_database.PlaytimeDatabase,
                "_create_schema",
                side_effect=sqlite3.OperationalError("simulated schema failure"),
            ),
            self.assertRaises(PlaytimeStorageError),
        ):
            outbox.enqueue(STEAM_ID, 42, 0, 1_000)

        self.assertFalse(self.outbox_path.exists())
        self.assertEqual(
            list(self.path.glob(f".{self.outbox_path.name}.*.tmp")),
            [],
        )
        self.assertTrue(outbox.enqueue(STEAM_ID, 42, 0, 1_000))

        recreated = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertEqual(
            recreated.pending(STEAM_ID),
            [{"appId": 42, "startedAt": 0, "endedAt": 1_000}],
        )

    def test_simultaneous_first_use_preserves_both_intervals(self) -> None:
        """Keep simultaneous first inserts from losing either interval."""
        checked_for_existing = Barrier(2, timeout=5)
        ready_to_publish = Barrier(2, timeout=5)
        original_path_exists = playtime_database.PlaytimeDatabase._path_exists
        original_link = playtime_database.os.link

        def synchronized_path_exists(
            database: playtime_database.PlaytimeDatabase,
        ) -> bool:
            exists = original_path_exists(database)
            checked_for_existing.wait()
            return exists

        def synchronized_link(source: str, destination: str) -> None:
            ready_to_publish.wait()
            original_link(source, destination)

        def enqueue(started_at: int) -> bool:
            return SQLitePlaytimeOutbox(self.outbox_path).enqueue(
                STEAM_ID,
                42,
                started_at,
                started_at + 1_000,
            )

        with (
            patch.object(
                playtime_database.PlaytimeDatabase,
                "_path_exists",
                new=synchronized_path_exists,
            ),
            patch.object(
                playtime_database.os,
                "link",
                side_effect=synchronized_link,
            ),
            ThreadPoolExecutor(max_workers=2) as executor,
        ):
            inserted = list(executor.map(enqueue, (0, 1_000)))

        self.assertEqual(inserted, [True, True])
        recreated = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertEqual(
            sorted(interval["startedAt"] for interval in recreated.pending(STEAM_ID)),
            [0, 1_000],
        )

    def test_simultaneous_outboxes_cannot_double_claim(self) -> None:
        """Prevent two durable outbox handles from claiming one batch."""
        first_outbox = SQLitePlaytimeOutbox(self.outbox_path)
        second_outbox = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertTrue(first_outbox.enqueue(STEAM_ID, 42, 0, 1_000))
        bound = first_outbox.bind(STEAM_ID, 42, self._request(0, 1_000))
        barrier = Barrier(2)

        def claim(outbox: SQLitePlaytimeOutbox) -> PlaytimeBatch | str:
            barrier.wait()
            return outbox.claim(STEAM_ID, 42, bound.request)

        with ThreadPoolExecutor(max_workers=2) as executor:
            claims = list(executor.map(claim, (first_outbox, second_outbox)))

        claimed = [result for result in claims if isinstance(result, PlaytimeBatch)]
        self.assertEqual(len(claimed), 1)
        self.assertEqual(
            [result for result in claims if not isinstance(result, PlaytimeBatch)],
            ["in_flight"],
        )

    def test_unlinked_outbox_fails_closed_during_its_lifetime(self) -> None:
        """Reject access after the live outbox database is unlinked."""
        outbox = SQLitePlaytimeOutbox(self.outbox_path)
        self.assertTrue(outbox.enqueue(STEAM_ID, 42, 0, 1_000))
        self.outbox_path.unlink()

        with self.assertRaises(PlaytimeStorageError):
            outbox.pending(STEAM_ID)

    def test_existing_empty_outbox_fails_closed(self) -> None:
        """Reject an existing empty outbox database."""
        self.outbox_path.touch()
        with self.assertRaises(PlaytimeStorageError):
            SQLitePlaytimeOutbox(self.outbox_path).pending(STEAM_ID)
