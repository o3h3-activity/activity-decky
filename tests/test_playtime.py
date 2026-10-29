"""Behavioral coverage for durable release-version playtime recording."""

import asyncio
import math
import threading
import unittest
from contextlib import AbstractContextManager
from datetime import UTC, datetime
from unittest.mock import Mock, patch
from urllib.parse import urlsplit

from backend_support import BackendTestCase, activity_main

from activity_backend.infrastructure import activity_transport as activity_api
from activity_backend.modules.activity.adapters.pending_playtime import (
    ACKNOWLEDGED_PLAYTIME_LIMIT,
    ACKNOWLEDGED_PLAYTIME_SETTING,
)
from activity_backend.modules.authorization.adapters import token_store
from activity_backend.shared import HttpJsonResponse

APP_ID = 42
STEAM_ID = "account-a"


class PlaytimeTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Verify Plugin records durable UTC-day release-version playtime totals."""

    game_id = "a0b1c2d3-1234-4abc-8def-0123456789ab"
    release_id = "b0b1c2d3-1234-4abc-8def-0123456789ab"
    revision_id = "c0b1c2d3-1234-4abc-8def-0123456789ab"
    alternate_ids = (
        "d0b1c2d3-1234-4abc-8def-0123456789ab",
        "e0b1c2d3-1234-4abc-8def-0123456789ab",
        "f0b1c2d3-1234-4abc-8def-0123456789ab",
    )

    def setUp(self) -> None:
        """Create one signed-in Plugin against an isolated settings file."""
        super().setUp()
        self.plugin = activity_main.Plugin()
        self._set_token(self.plugin, "account-a-token")
        self.plugin.backend.settings.update(
            {activity_main.PLAY_TIME_SYNC_ENABLED_SETTING: True}
        )

    @staticmethod
    def _response(status: int, body: object = None) -> HttpJsonResponse:
        """Build a status response at the shared HTTP boundary."""
        return HttpJsonResponse(status, body, 0)

    @staticmethod
    def _millis(
        year: int,
        month: int,
        day: int,
        hour: int,
        minute: int,
        second: int,
        microsecond: int,
    ) -> int:
        """Return an exact epoch-millisecond instant in UTC."""
        return int(
            datetime(
                year, month, day, hour, minute, second, microsecond, tzinfo=UTC
            ).timestamp()
            * 1000
        )

    @staticmethod
    def _set_token(plugin: object, token: str) -> None:
        """Install a usable token without driving the device authorization flow."""
        plugin.backend.settings.update(
            {
                token_store.ACCESS_TOKEN_SETTING: token,
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: (
                    "2999-10-27T00:00:00+00:00"
                ),
            }
        )

    async def _record(
        self,
        started_at: object,
        ended_at: object,
        *,
        plugin: object = None,
        ids: tuple[str, str, str] | None = None,
        steam_id: str = STEAM_ID,
    ) -> object:
        """Submit one interval using the queued-recording RPC contract."""
        game_id, release_id, revision_id = ids or (
            self.game_id,
            self.release_id,
            self.revision_id,
        )
        return await (plugin or self.plugin).record_playtime(
            game_id, release_id, revision_id, started_at, ended_at, steam_id, APP_ID
        )

    async def _enqueue(self, started_at: int, ended_at: int) -> bool:
        """Queue one committed interval without contacting Activity."""
        return await self.plugin.enqueue_playtime(
            STEAM_ID, APP_ID, started_at, ended_at
        )

    async def _pending(self, plugin: object = None) -> list[tuple[int, int]]:
        """Return the queued intervals as `(startedAt, endedAt)` pairs."""
        pending = await (plugin or self.plugin).get_pending_playtime(STEAM_ID)
        return [(entry["startedAt"], entry["endedAt"]) for entry in pending]

    @staticmethod
    def _user(steam_id: str) -> dict[str, object]:
        """Build the authenticated account response used for durable scoping."""
        return {
            "nickname": steam_id,
            "avatarUrl": None,
            "steamId": steam_id,
        }

    def _activity(
        self, put_statuses: list[int] | None = None, *, user: str = STEAM_ID
    ) -> AbstractContextManager[Mock]:
        """Fake Activity: `/me` is `user`; PUTs answer `put_statuses` in order, else 204."""

        def request_json_status(url: str, **_details: object) -> HttpJsonResponse:
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user(user))
            return self._response(204 if put_statuses is None else put_statuses.pop(0))

        return patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        )

    @staticmethod
    def _paths(request: Mock) -> list[str]:
        """Return the URL path of every captured Activity request."""
        return [urlsplit(call.args[0]).path for call in request.call_args_list]

    @staticmethod
    def _put_calls(request: Mock) -> list[tuple[str, int]]:
        """Extract the API UTC day and cumulative seconds from captured PUTs."""
        return [
            (
                urlsplit(call.args[0]).path.rsplit("/", 1)[-1],
                call.kwargs["body"]["seconds"],
            )
            for call in request.call_args_list
            if call.kwargs["method"] == "PUT"
        ]

    def _day_path(self, day: str) -> str:
        """Return the day-total route for the primary release revision."""
        return (
            f"/api/v1/me/games/{self.game_id}/releases/{self.release_id}"
            f"/versions/{self.revision_id}/playtime/days/{day}"
        )

    async def test_signed_out_does_not_send_playtime(self) -> None:
        """Refuse recording without making an Activity HTTP request after sign-out."""
        await self.plugin.sign_out_activity()
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(activity_api, "request_json_status") as request:
            result = await self._record(start, start + 1_000)

        self.assertEqual(result, {"ok": False, "error": "notSignedIn", "status": 0})
        request.assert_not_called()

    async def test_same_day_intervals_replace_the_cumulative_total(self) -> None:
        """Two committed intervals upload increasingly cumulative, floored seconds."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with self._activity() as request:
            first = await self._record(start, start + 1_300)
            second = await self._record(start + 10_000, start + 12_700)

        self.assertEqual(first, {"ok": True, "data": None})
        self.assertEqual(second, {"ok": True, "data": None})
        self.assertEqual(
            self._put_calls(request), [("2026-03-04", 1), ("2026-03-04", 4)]
        )

    async def test_interval_crossing_utc_midnight_replaces_each_day_total(self) -> None:
        """Split an interval exactly at the UTC day boundary before uploading totals."""
        started_at = self._millis(2026, 3, 4, 23, 59, 58, 500_000)
        ended_at = self._millis(2026, 3, 5, 0, 0, 2, 500_000)
        with self._activity() as request:
            result = await self._record(started_at, ended_at)

        self.assertEqual(result, {"ok": True, "data": None})
        self.assertEqual(
            self._put_calls(request), [("2026-03-04", 1), ("2026-03-05", 2)]
        )

    async def test_totals_survive_backend_recreation(self) -> None:
        """A new Plugin instance continues totals persisted by its predecessor."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with self._activity() as request:
            self.assertEqual(
                await self._record(start, start + 1_500),
                {"ok": True, "data": None},
            )
            recreated = activity_main.Plugin()
            self.assertEqual(
                await self._record(start + 5_000, start + 6_500, plugin=recreated),
                {"ok": True, "data": None},
            )

        self.assertEqual(
            self._put_calls(request), [("2026-03-04", 1), ("2026-03-04", 3)]
        )

    async def test_concurrent_commits_wait_for_the_prior_put_before_replacing_total(
        self,
    ) -> None:
        """Keep a later total from reaching the API before the prior PUT commits."""
        first_put_started = threading.Event()
        release_first_put = threading.Event()
        second_put_started = threading.Event()
        put_count = 0

        def request_json_status(url: str, **_details: object) -> HttpJsonResponse:
            nonlocal put_count
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user(STEAM_ID))
            put_count += 1
            if put_count == 1:
                first_put_started.set()
                if not release_first_put.wait(timeout=5):
                    raise TimeoutError("First playtime PUT was not released")
            else:
                second_put_started.set()
            return self._response(204)

        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ) as request:
            first = asyncio.create_task(self._record(start, start + 1_000))
            try:
                self.assertTrue(await asyncio.to_thread(first_put_started.wait, 5))
                self.assertTrue(
                    await asyncio.wait_for(
                        self._enqueue(start + 2_000, start + 4_000), timeout=1
                    )
                )
                self.assertEqual(
                    await self._pending(),
                    [(start, start + 1_000), (start + 2_000, start + 4_000)],
                )
                second = asyncio.create_task(self._record(start + 2_000, start + 4_000))
                self.assertFalse(await asyncio.to_thread(second_put_started.wait, 0.1))
            finally:
                release_first_put.set()
            results = await asyncio.gather(first, second)

        self.assertEqual(results, [{"ok": True, "data": None}] * 2)
        self.assertEqual(
            self._put_calls(request), [("2026-03-04", 1), ("2026-03-04", 3)]
        )

    async def test_totals_are_scoped_by_steam_account_not_bearer_token(
        self,
    ) -> None:
        """A token replacement retains its total; a different account starts clean."""
        users = {
            "account-a-token": "76561198000000001",
            "account-a-replacement-token": "76561198000000001",
            "account-b-token": "76561198000000002",
        }

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user(users[details["bearer_token"]]))
            return self._response(204)

        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ) as request:
            await self._record(start, start + 1_500, steam_id="76561198000000001")
            self._set_token(self.plugin, "account-a-replacement-token")
            await self._record(
                start + 3_000, start + 4_500, steam_id="76561198000000001"
            )
            self._set_token(self.plugin, "account-b-token")
            result = await self._record(
                start + 6_000, start + 7_500, steam_id="76561198000000002"
            )

        self.assertEqual(result, {"ok": True, "data": None})
        self.assertEqual(
            self._put_calls(request),
            [("2026-03-04", 1), ("2026-03-04", 3), ("2026-03-04", 1)],
        )

    async def test_missing_steam_id_never_falls_back_to_a_token_scoped_total(
        self,
    ) -> None:
        """Refuse recording without the current account's stable identifier."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=self._response(
                200,
                {
                    "nickname": "No stable identifier",
                    "avatarUrl": None,
                    "steamId": None,
                },
            ),
        ) as request:
            result = await self._record(start, start + 1_000)

        self.assertEqual(result, {"ok": False, "error": "invalidResponse", "status": 0})
        self.assertEqual(self._paths(request), ["/api/v1/me"])

    async def test_invalid_ids_and_timestamps_do_not_make_http_requests(
        self,
    ) -> None:
        """Reject malformed RPC input before looking up an account or writing totals."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        ids = (self.game_id, self.release_id, self.revision_id)
        invalid_requests = (
            ("not-a-uuid", self.release_id, self.revision_id, start, start + 1),
            (self.game_id, None, self.revision_id, start, start + 1),
            (self.game_id, self.release_id, "not-a-uuid", start, start + 1),
            (*ids, True, start + 1),
            (*ids, start, math.nan),
            (*ids, start + 1, start),
        )
        with patch.object(activity_api, "request_json_status") as request:
            for arguments in invalid_requests:
                with self.subTest(arguments=arguments):
                    self.assertEqual(
                        await self.plugin.record_playtime(*arguments, STEAM_ID, APP_ID),
                        {"ok": False, "error": "invalidRequest", "status": 0},
                    )

        request.assert_not_called()

    async def test_failed_put_keeps_total_for_the_next_committed_interval(self) -> None:
        """A transient failed replacement does not discard locally accumulated time."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with self._activity([503, 204]) as request:
            failed = await self._record(start, start + 1_500)
            succeeded = await self._record(start + 5_000, start + 6_500)

        self.assertEqual(failed, {"ok": False, "error": "httpError", "status": 503})
        self.assertEqual(succeeded, {"ok": True, "data": None})
        self.assertEqual(
            self._put_calls(request), [("2026-03-04", 1), ("2026-03-04", 3)]
        )

    async def test_empty_success_is_accepted_and_401_ends_the_current_session(
        self,
    ) -> None:
        """Map the replacement status and invalidate the rejected current credential."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with self._activity([204, 401]) as request:
            successful = await self._record(start, start + 1_000)
            rejected = await self._record(start + 2_000, start + 3_000)

        self.assertEqual(successful, {"ok": True, "data": None})
        self.assertEqual(
            rejected,
            {"ok": False, "error": "unauthorized", "status": 401},
        )
        self.assertIsNone(self.plugin.backend.authorization.access_token())
        self.assertEqual(
            self.plugin.backend.authorization.get_state()["status"], "signedOut"
        )
        self.assertEqual(
            self._put_calls(request), [("2026-03-04", 1), ("2026-03-04", 2)]
        )

    async def test_enqueue_is_local_and_survives_backend_recreation(self) -> None:
        """Queueing a committed interval does not require Activity to be reachable."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(activity_api, "request_json_status") as request:
            self.assertTrue(await self._enqueue(start, start + 1_000))
            self.assertFalse(await self._enqueue(start, start + 1_000))
            pending = await activity_main.Plugin().get_pending_playtime(STEAM_ID)

        self.assertEqual(
            pending,
            [{"appId": APP_ID, "startedAt": start, "endedAt": start + 1_000}],
        )
        request.assert_not_called()

    async def test_only_the_sharing_opt_in_gates_local_queueing(self) -> None:
        """An expired session still queues; only a disabled opt-in drops the interval."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        await self.plugin.set_play_time_sync_enabled(False)
        with patch.object(activity_api, "request_json_status") as request:
            self.assertFalse(await self._enqueue(start, start + 1_000))
            await self.plugin.set_play_time_sync_enabled(True)
            self.plugin.backend.settings.update(
                {
                    token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: (
                        "2000-01-01T00:00:00+00:00"
                    )
                }
            )
            self.assertTrue(await self._enqueue(start + 2_000, start + 3_000))

        self.assertEqual(await self._pending(), [(start + 2_000, start + 3_000)])
        request.assert_not_called()

    async def test_disabled_sharing_keeps_queued_interval_without_http(self) -> None:
        """Turning sharing off pauses delivery with its own code; the interval stays queued."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        self.assertTrue(await self._enqueue(start, start + 1_000))
        await self.plugin.set_play_time_sync_enabled(False)
        with patch.object(activity_api, "request_json_status") as request:
            result = await self._record(start, start + 1_000)

        self.assertEqual(result, {"ok": False, "error": "sharingDisabled", "status": 0})
        self.assertEqual(
            await self.plugin.get_pending_playtime(STEAM_ID),
            [{"appId": APP_ID, "startedAt": start, "endedAt": start + 1_000}],
        )
        request.assert_not_called()

    async def test_failed_account_lookup_keeps_the_resolved_interval(self) -> None:
        """A failed `/me` after durable identity binding leaves the interval pending."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        self.assertTrue(await self._enqueue(start, start + 1_000))
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=self._response(503, {}),
        ) as request:
            result = await self._record(start, start + 1_000)

        self.assertEqual(result, {"ok": False, "error": "invalidResponse", "status": 0})
        self.assertEqual(
            await self.plugin.get_pending_playtime(STEAM_ID),
            [
                {
                    "appId": APP_ID,
                    "startedAt": start,
                    "endedAt": start + 1_000,
                    "gameId": self.game_id,
                    "releaseId": self.release_id,
                    "releaseRevisionId": self.revision_id,
                }
            ],
        )
        self.assertEqual(self._paths(request), ["/api/v1/me"])

    async def test_other_activity_account_cannot_upload_queued_interval(self) -> None:
        """A queued Steam account never crosses into a different Activity account."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        self.assertTrue(await self._enqueue(start, start + 1_000))
        with self._activity(user="account-b") as request:
            result = await self._record(start, start + 1_000)

        self.assertEqual(result, {"ok": False, "error": "accountMismatch", "status": 0})
        self.assertEqual(self._paths(request), ["/api/v1/me"])
        self.assertEqual(await self.plugin.get_pending_playtime("account-b"), [])
        self.assertEqual(await self._pending(), [(start, start + 1_000)])

    async def test_only_a_refused_interval_is_discarded(self) -> None:
        """404 and 422 drop the interval as refused; other client errors keep it."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        for status, kept in (
            (404, False),
            (422, False),
            (403, True),
            (408, True),
            (429, True),
        ):
            with self.subTest(status=status):
                self.assertTrue(await self._enqueue(start, start + 1_000))
                with self._activity([status, status]):
                    result = await self._record(start, start + 1_000)

                self.assertEqual(
                    result,
                    {
                        "ok": False,
                        "error": "httpError" if kept else "refused",
                        "status": status,
                    },
                )
                self.assertEqual((start, start + 1_000) in await self._pending(), kept)
                start += 2_000

    async def test_refused_interval_is_withdrawn_from_every_day_total(self) -> None:
        """A refusal removes the interval's time and restores every affected day."""
        earlier = self._millis(2026, 3, 4, 23, 0, 0, 0)
        started_at = self._millis(2026, 3, 4, 23, 59, 58, 500_000)
        ended_at = self._millis(2026, 3, 5, 0, 0, 2, 500_000)
        later = self._millis(2026, 3, 5, 1, 0, 0, 0)
        with self._activity([204, 204, 422, 204, 204, 204]) as request:
            accepted = await self._record(earlier, earlier + 1_000)
            refused = await self._record(started_at, ended_at)
            following = await self._record(later, later + 1_000)

        self.assertEqual(accepted, {"ok": True, "data": None})
        self.assertEqual(refused, {"ok": False, "error": "refused", "status": 422})
        self.assertEqual(following, {"ok": True, "data": None})
        self.assertEqual(
            self._put_calls(request),
            [
                ("2026-03-04", 1),
                ("2026-03-04", 2),
                ("2026-03-05", 2),
                ("2026-03-04", 1),
                ("2026-03-05", 0),
                ("2026-03-05", 1),
            ],
        )
        self.assertEqual(await self._pending(), [])

    async def test_refused_interval_repairs_time_published_by_later_interval(
        self,
    ) -> None:
        """Repair another interval's cumulative upload, resuming after a failed repair."""
        remote: dict[str, int] = {}
        statuses = [204, 503, 204, 422, 204, 503, 204, 204]

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user(STEAM_ID))
            status = statuses.pop(0)
            if status == 204:
                day = urlsplit(url).path.rsplit("/", 1)[-1]
                remote[day] = details["body"]["seconds"]
            return self._response(status)

        earlier = self._millis(2026, 3, 4, 0, 0, 0, 0)
        interval = (
            self._millis(2026, 3, 4, 22, 0, 0, 0),
            self._millis(2026, 3, 5, 0, 0, 1, 0),
        )
        later = self._millis(2026, 3, 5, 1, 0, 0, 0)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ):
            accepted = await self._record(
                earlier, self._millis(2026, 3, 4, 23, 0, 0, 0)
            )
            failed = await self._record(*interval)
            following = await self._record(later, later + 2_000)
            self.assertEqual(accepted, {"ok": True, "data": None})
            self.assertEqual(failed, {"ok": False, "error": "httpError", "status": 503})
            self.assertEqual(following, {"ok": True, "data": None})
            self.assertEqual(remote, {"2026-03-04": 82_800, "2026-03-05": 3})
            self.assertEqual(await self._pending(), [interval])

            restoring = await self._record(*interval)
            self.assertEqual(
                restoring, {"ok": False, "error": "httpError", "status": 503}
            )
            self.assertEqual(await self._pending(), [interval])
            self.assertEqual(remote, {"2026-03-04": 82_800, "2026-03-05": 3})

            recreated = activity_main.Plugin()
            restored = await self._record(*interval, plugin=recreated)
            self.assertEqual(restored, {"ok": False, "error": "refused", "status": 422})
            self.assertEqual(remote, {"2026-03-04": 82_800, "2026-03-05": 2})
            self.assertEqual(await self._pending(recreated), [])
            self.assertEqual(await self._record(*interval, plugin=recreated), restored)
            self.assertEqual(remote, {"2026-03-04": 82_800, "2026-03-05": 2})

    async def test_failed_restoration_survives_backend_recreation(self) -> None:
        """Keep refused time withdrawn while retrying its failed day-total repair."""
        remote: dict[str, int] = {}
        statuses = [204, 204, 422, 503, 204, 204, 204]

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user(STEAM_ID))
            status = statuses.pop(0)
            if status == 204:
                day = urlsplit(url).path.rsplit("/", 1)[-1]
                remote[day] = details["body"]["seconds"]
            return self._response(status)

        earlier = self._millis(2026, 3, 4, 23, 0, 0, 0)
        interval = (
            self._millis(2026, 3, 4, 23, 59, 58, 500_000),
            self._millis(2026, 3, 5, 0, 0, 2, 500_000),
        )
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ) as request:
            await self._record(earlier, earlier + 1_000)
            failed = await self._record(*interval)
            self.assertEqual(failed, {"ok": False, "error": "httpError", "status": 503})
            self.assertEqual(remote, {"2026-03-04": 2})
            self.assertEqual(await self._pending(), [interval])

            recreated = activity_main.Plugin()
            restored = await self._record(*interval, plugin=recreated)
            self.assertEqual(restored, {"ok": False, "error": "refused", "status": 422})
            self.assertEqual(remote, {"2026-03-04": 1, "2026-03-05": 0})
            self.assertEqual(await self._pending(recreated), [])
            following = await self._record(
                earlier + 2_000, earlier + 4_000, plugin=recreated
            )

        self.assertEqual(following, {"ok": True, "data": None})
        self.assertEqual(remote, {"2026-03-04": 3, "2026-03-05": 0})
        self.assertEqual(
            self._put_calls(request),
            [
                ("2026-03-04", 1),
                ("2026-03-04", 2),
                ("2026-03-05", 2),
                ("2026-03-04", 1),
                ("2026-03-04", 1),
                ("2026-03-05", 0),
                ("2026-03-04", 3),
            ],
        )

    async def test_refused_restoration_still_discards_the_interval(self) -> None:
        """A day-total repair Activity also refuses cannot keep retrying forever."""
        interval = (
            self._millis(2026, 3, 4, 23, 59, 58, 500_000),
            self._millis(2026, 3, 5, 0, 0, 2, 500_000),
        )
        with self._activity([204, 422, 404, 404]) as request:
            refused = await self._record(*interval)
            retried = await self._record(*interval)

        self.assertEqual(refused, {"ok": False, "error": "refused", "status": 422})
        self.assertEqual(retried, refused)
        self.assertEqual(await self._pending(), [])
        self.assertEqual(
            self._put_calls(request),
            [
                ("2026-03-04", 1),
                ("2026-03-05", 2),
                ("2026-03-04", 0),
                ("2026-03-05", 0),
            ],
        )

    async def test_disabled_sharing_pauses_restoration_without_discarding_it(
        self,
    ) -> None:
        """Resume only the corrected total after sharing stops during a refusal."""
        statuses = [204, 422, 204, 204]

        def request_json_status(url: str, **_details: object) -> HttpJsonResponse:
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user(STEAM_ID))
            status = statuses.pop(0)
            if status == 422:
                self.plugin.backend.settings.update(
                    {activity_main.PLAY_TIME_SYNC_ENABLED_SETTING: False}
                )
            return self._response(status)

        interval = (
            self._millis(2026, 3, 4, 23, 59, 58, 500_000),
            self._millis(2026, 3, 5, 0, 0, 2, 500_000),
        )
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ) as request:
            paused = await self._record(*interval)
            self.assertEqual(
                paused, {"ok": False, "error": "sharingDisabled", "status": 0}
            )
            self.assertEqual(
                self._put_calls(request), [("2026-03-04", 1), ("2026-03-05", 2)]
            )
            self.assertEqual(await self._pending(), [interval])
            await self.plugin.set_play_time_sync_enabled(True)
            recreated = activity_main.Plugin()
            restored = await self._record(*interval, plugin=recreated)

        self.assertEqual(restored, {"ok": False, "error": "refused", "status": 422})
        self.assertEqual(await self._pending(recreated), [])
        self.assertEqual(
            self._put_calls(request),
            [
                ("2026-03-04", 1),
                ("2026-03-05", 2),
                ("2026-03-04", 0),
                ("2026-03-05", 0),
            ],
        )

    async def test_acknowledged_history_keeps_only_the_most_recent_uploads(
        self,
    ) -> None:
        """Uploaded intervals stop accumulating once the deduplication window is full."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        intervals = [
            (start + index * 2_000, start + index * 2_000 + 1_000)
            for index in range(ACKNOWLEDGED_PLAYTIME_LIMIT + 1)
        ]
        with self._activity():
            for interval in intervals:
                await self._record(*interval)

        acknowledged = self.plugin.backend.settings.get(
            ACKNOWLEDGED_PLAYTIME_SETTING, dict
        )
        self.assertEqual(len(acknowledged[STEAM_ID]), ACKNOWLEDGED_PLAYTIME_LIMIT)
        for interval, requeued in ((intervals[0], True), (intervals[1], False)):
            self.assertEqual(await self._enqueue(*interval), requeued)
            self.assertEqual(interval in await self._pending(), requeued)

    async def test_success_removes_only_the_uploaded_interval(self) -> None:
        """A completed delivery preserves another unresolved commit in the same queue."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        self.assertTrue(await self._enqueue(start, start + 1_000))
        self.assertTrue(await self._enqueue(start + 2_000, start + 3_000))
        with self._activity():
            result = await self._record(start, start + 1_000)

        self.assertEqual(result, {"ok": True, "data": None})
        self.assertEqual(await self._pending(), [(start + 2_000, start + 3_000)])

    async def test_retry_after_partial_utc_day_failure_is_idempotent(self) -> None:
        """Retrying a cross-day interval keeps it queued and replaces unchanged totals."""
        started_at = self._millis(2026, 3, 4, 23, 59, 58, 500_000)
        ended_at = self._millis(2026, 3, 5, 0, 0, 2, 500_000)
        self.assertTrue(await self._enqueue(started_at, ended_at))
        with self._activity([204, 503, 204, 204]) as request:
            first = await self._record(started_at, ended_at)
            second = await self._record(started_at, ended_at)

        self.assertEqual(first, {"ok": False, "error": "httpError", "status": 503})
        self.assertEqual(second, {"ok": True, "data": None})
        self.assertEqual(
            self._put_calls(request),
            [
                ("2026-03-04", 1),
                ("2026-03-05", 2),
                ("2026-03-04", 1),
                ("2026-03-05", 2),
            ],
        )
        self.assertEqual(await self._pending(), [])

    async def test_retry_uses_the_first_durable_release_identity(self) -> None:
        """A retried RPC cannot change an interval's already bound release identity."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        self.assertTrue(await self._enqueue(start, start + 1_000))
        with self._activity([503, 204]) as request:
            first = await self._record(start, start + 1_000)
            second = await self._record(start, start + 1_000, ids=self.alternate_ids)

        self.assertEqual(first, {"ok": False, "error": "httpError", "status": 503})
        self.assertEqual(second, {"ok": True, "data": None})
        self.assertEqual(
            self._paths(request),
            [
                "/api/v1/me",
                self._day_path("2026-03-04"),
                "/api/v1/me",
                self._day_path("2026-03-04"),
            ],
        )
        self.assertEqual(await self._pending(), [])

    async def test_lost_response_retry_uses_acknowledged_interval_without_uploading(
        self,
    ) -> None:
        """An already acknowledged interval is successful without returning to pending."""
        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        self.assertTrue(await self._enqueue(start, start + 1_000))
        with self._activity() as request:
            uploaded = await self._record(start, start + 1_000)
            retried = await self._record(start, start + 1_000, ids=self.alternate_ids)

        self.assertEqual(uploaded, {"ok": True, "data": None})
        self.assertEqual(retried, {"ok": True, "data": None})
        self.assertEqual(
            self._paths(request), ["/api/v1/me", self._day_path("2026-03-04")]
        )
        self.assertFalse(await self._enqueue(start, start + 1_000))
        self.assertEqual(await self._pending(), [])
