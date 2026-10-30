"""Failure-boundary behavior for the PlayTime RPC service."""

import asyncio
import logging
import unittest
from collections.abc import Awaitable, Callable
from unittest.mock import patch

from backend_support import BackendTestCase

from activity_backend.modules.activity.adapters.sqlite_playtime import (
    SQLitePlaytimeOutbox,
)
from activity_backend.modules.activity.playtime_outbox import (
    PlaytimeOutbox,
    PlaytimeStorageError,
)
from activity_backend.modules.activity.playtime_service import PlaytimeService
from activity_backend.modules.activity.results import EndpointSuccess
from activity_backend.modules.authorization.api import ActivityUser

STEAM_ID = "account-a"
GAME_ID = "a0b1c2d3-1234-4abc-8def-0123456789ab"
RELEASE_ID = "b0b1c2d3-1234-4abc-8def-0123456789ab"
REVISION_ID = "c0b1c2d3-1234-4abc-8def-0123456789ab"


def _user(steam_id: str | None) -> ActivityUser:
    return {"nickname": "tester", "avatarUrl": None, "steamId": steam_id}


class _Session:
    def __init__(self) -> None:
        self.token = "token"

    def access_token(self) -> str | None:
        return self.token

    async def end_session(self, token: str) -> None:
        if self.token == token:
            self.token = None


class _Endpoint:
    def __init__(
        self,
        outcome: str = "success",
        status: int = 204,
        after_call: Callable[[int], None] | None = None,
    ) -> None:
        self.outcome = outcome
        self.status = status
        self.after_call = after_call
        self.entered = asyncio.Event()
        self.calls = 0

    async def record_playtime(self, _sessions: object, _token: str) -> EndpointSuccess:
        self.calls += 1
        self.entered.set()
        if self.after_call is not None:
            self.after_call(self.calls)
        if self.outcome == "raise":
            raise RuntimeError("transport failure")
        if self.outcome == "wait":
            await asyncio.Event().wait()
        return EndpointSuccess(self.status, None)


class PlaytimeServiceFailureTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Ensure unsafe network outcomes remain outside automatic retry paths."""

    def setUp(self) -> None:
        """Create enabled sharing state with an authenticated session."""
        super().setUp()
        self.enabled = True
        self.session = _Session()

    def _service(
        self,
        endpoint: _Endpoint,
        user: ActivityUser | None = None,
        outbox: PlaytimeOutbox | None = None,
        current_user: Callable[[], Awaitable[ActivityUser | None]] | None = None,
    ) -> PlaytimeService:
        async def default_current_user() -> ActivityUser:
            return _user(STEAM_ID) if user is None else user

        return PlaytimeService(
            endpoint,
            self.session,
            logging.getLogger("activity-tests"),
            outbox
            if outbox is not None
            else SQLitePlaytimeOutbox(self.path / "playtime.sqlite3"),
            lambda: self.enabled,
            default_current_user if current_user is None else current_user,
        )

    async def _record(
        self, service: PlaytimeService, *, ended_at: int = 1_000
    ) -> object:
        return await service.record_playtime(
            GAME_ID, RELEASE_ID, REVISION_ID, 0, ended_at, STEAM_ID, 42
        )

    async def test_exception_holds_the_interval_across_service_recreation(self) -> None:
        """Hold an indeterminate interval across service recreation."""
        failed_endpoint = _Endpoint("raise")
        failed = self._service(failed_endpoint)
        self.assertEqual(
            await self._record(failed),
            {"ok": False, "error": "deliveryUnknown", "status": 0},
        )

        retried_endpoint = _Endpoint()
        recreated = self._service(retried_endpoint)
        self.assertEqual(
            await self._record(recreated),
            {"ok": False, "error": "deliveryUnknown", "status": 0},
        )
        self.assertEqual(retried_endpoint.calls, 0)

    async def test_cancellation_leaves_the_predispatch_mark_held_on_restart(
        self,
    ) -> None:
        """Hold a pre-dispatch interval after task cancellation."""
        endpoint = _Endpoint("wait")
        task = asyncio.create_task(self._record(self._service(endpoint)))
        await endpoint.entered.wait()
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task

        retried_endpoint = _Endpoint()
        recreated = self._service(retried_endpoint)
        self.assertEqual(
            await self._record(recreated),
            {"ok": False, "error": "deliveryUnknown", "status": 0},
        )
        self.assertEqual(retried_endpoint.calls, 0)

    async def test_opt_in_and_account_match_are_checked_after_current_user_wait(
        self,
    ) -> None:
        """Recheck sharing policy after awaiting the current user."""
        endpoint = _Endpoint()

        async def changed_user() -> ActivityUser:
            self.enabled = False
            return _user(STEAM_ID)

        service = self._service(endpoint, current_user=changed_user)
        self.assertEqual(
            await self._record(service),
            {"ok": False, "error": "sharingDisabled", "status": 0},
        )
        self.assertEqual(endpoint.calls, 0)

    async def test_sign_out_or_token_change_during_current_user_prevents_dispatch(
        self,
    ) -> None:
        """Prevent dispatch when the session changes while awaiting a user."""
        for replacement in (None, "replacement-token"):
            with self.subTest(replacement=replacement):
                self.session = _Session()
                endpoint = _Endpoint()

                async def changed_user(token: str | None = replacement) -> ActivityUser:
                    self.session.token = token
                    return _user(STEAM_ID)

                self.assertEqual(
                    await self._record(
                        self._service(endpoint, current_user=changed_user)
                    ),
                    {"ok": False, "error": "notSignedIn", "status": 0},
                )
                self.assertEqual(endpoint.calls, 0)

    async def test_mismatched_current_account_never_dispatches(self) -> None:
        """Prevent dispatch for a current user from another account."""
        endpoint = _Endpoint()
        service = self._service(endpoint, _user("account-b"))

        self.assertEqual(
            await self._record(service),
            {"ok": False, "error": "accountMismatch", "status": 0},
        )
        self.assertEqual(endpoint.calls, 0)

    async def test_pending_storage_failure_propagates(self) -> None:
        """Propagate durable outbox failures when reading pending work."""
        path = self.path / "playtime.sqlite3"
        path.touch()
        service = self._service(_Endpoint(), outbox=SQLitePlaytimeOutbox(path))

        with self.assertRaises(PlaytimeStorageError):
            await service.get_pending_playtime(STEAM_ID)

    async def test_enqueue_storage_failure_propagates(self) -> None:
        """Propagate durable outbox failures when queuing an interval."""
        path = self.path / "playtime.sqlite3"
        path.touch()
        service = self._service(_Endpoint(), outbox=SQLitePlaytimeOutbox(path))

        with self.assertRaises(PlaytimeStorageError):
            await service.enqueue_playtime(STEAM_ID, 42, 0, 1_000)

    async def test_acknowledgement_failure_holds_an_accepted_batch(self) -> None:
        """Hold a delivered batch when its acknowledgement cannot persist."""
        outbox = SQLitePlaytimeOutbox(self.path / "playtime.sqlite3")
        service = self._service(_Endpoint(), outbox=outbox)
        with patch.object(
            outbox, "acknowledge", side_effect=PlaytimeStorageError("disk full")
        ):
            self.assertEqual(
                await self._record(service),
                {"ok": False, "error": "deliveryUnknown", "status": 0},
            )

        endpoint = _Endpoint()
        self.assertEqual(
            await self._record(self._service(endpoint, outbox=outbox)),
            {"ok": False, "error": "deliveryUnknown", "status": 0},
        )
        self.assertEqual(endpoint.calls, 0)

    async def test_only_http_204_acknowledges_a_dispatch(self) -> None:
        """Acknowledge only an HTTP 204 endpoint response."""
        outbox = SQLitePlaytimeOutbox(self.path / "playtime.sqlite3")
        self.assertEqual(
            await self._record(self._service(_Endpoint(status=200), outbox=outbox)),
            {"ok": False, "error": "deliveryUnknown", "status": 200},
        )

        endpoint = _Endpoint()
        self.assertEqual(
            await self._record(self._service(endpoint, outbox=outbox)),
            {"ok": False, "error": "deliveryUnknown", "status": 0},
        )
        self.assertEqual(endpoint.calls, 0)

    async def test_policy_revocation_after_first_batch_prevents_the_next_dispatch(
        self,
    ) -> None:
        """Stop dispatching later batches after sharing policy revocation."""
        endpoint = _Endpoint(
            after_call=lambda calls: setattr(self, "enabled", calls != 1)
        )

        self.assertEqual(
            await self._record(
                self._service(endpoint), ended_at=1_001 * 24 * 60 * 60 * 1_000
            ),
            {"ok": False, "error": "sharingDisabled", "status": 0},
        )
        self.assertEqual(endpoint.calls, 1)

    async def test_final_acknowledgment_succeeds_when_sharing_stops_during_request(
        self,
    ) -> None:
        """Acknowledge a dispatched batch despite post-dispatch policy change."""
        endpoint = _Endpoint(after_call=lambda _calls: setattr(self, "enabled", False))
        service = self._service(endpoint)
        self.assertEqual(
            await self._record(service),
            {"ok": True, "data": None},
        )
        self.assertEqual(await service.get_pending_playtime(STEAM_ID), [])
