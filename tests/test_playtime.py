"""Behavioral coverage for durable additive release-version playtime recording."""

import unittest
from datetime import UTC, datetime
from unittest.mock import Mock, patch
from urllib.parse import urlsplit

from backend_support import BackendTestCase, activity_main

from activity_backend.infrastructure import activity_transport as activity_api
from activity_backend.modules.authorization.adapters import token_store
from activity_backend.shared import HttpJsonResponse

APP_ID = 42
STEAM_ID = "account-a"


class PlaytimeTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Verify Plugin records exact additive sessions without unsafe retransmission."""

    game_id = "a0b1c2d3-1234-4abc-8def-0123456789ab"
    release_id = "b0b1c2d3-1234-4abc-8def-0123456789ab"
    revision_id = "c0b1c2d3-1234-4abc-8def-0123456789ab"

    def setUp(self) -> None:
        """Create a signed-in plugin with playtime synchronization enabled."""
        super().setUp()
        self.plugin = activity_main.Plugin()
        self._set_token(self.plugin, "account-a-token")
        self.plugin.backend.settings.update(
            {activity_main.PLAY_TIME_SYNC_ENABLED_SETTING: True}
        )

    @staticmethod
    def _response(status: int, body: object = None) -> HttpJsonResponse:
        return HttpJsonResponse(status, body, 0)

    @staticmethod
    def _millis(
        year: int, month: int, day: int, hour: int, minute: int, second: int
    ) -> int:
        return int(
            datetime(year, month, day, hour, minute, second, tzinfo=UTC).timestamp()
            * 1000
        )

    @staticmethod
    def _set_token(plugin: object, token: str) -> None:
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
        app_id: int = APP_ID,
    ) -> object:
        game_id, release_id, revision_id = ids or (
            self.game_id,
            self.release_id,
            self.revision_id,
        )
        return await (plugin or self.plugin).record_playtime(
            game_id, release_id, revision_id, started_at, ended_at, STEAM_ID, app_id
        )

    def _activity(self, statuses: list[int | None] | None = None) -> patch:
        def request_json_status(
            url: str, **_details: object
        ) -> HttpJsonResponse | None:
            if urlsplit(url).path == "/api/v1/me":
                return self._response(
                    200,
                    {"nickname": STEAM_ID, "avatarUrl": None, "steamId": STEAM_ID},
                )
            status = 204 if statuses is None else statuses.pop(0)
            return None if status is None else self._response(status)

        return patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        )

    @staticmethod
    def _posts(request: Mock) -> list[list[dict[str, object]]]:
        return [
            call.kwargs["body"]
            for call in request.call_args_list
            if call.kwargs["method"] == "POST"
        ]

    async def test_sessions_post_to_the_additive_endpoint(self) -> None:
        """Post separate recorded intervals to the additive endpoint."""
        start = self._millis(2026, 3, 4, 12, 0, 0)
        with self._activity() as request:
            first = await self._record(start, start + 1_300)
            second = await self._record(start + 10_000, start + 12_700)

        self.assertEqual(first, {"ok": True, "data": None})
        self.assertEqual(second, {"ok": True, "data": None})
        self.assertEqual(
            self._posts(request),
            [
                [
                    {
                        "date": "2026-03-04",
                        "gameId": self.game_id,
                        "releaseId": self.release_id,
                        "releaseVersionId": self.revision_id,
                        "seconds": 1,
                    }
                ],
                [
                    {
                        "date": "2026-03-04",
                        "gameId": self.game_id,
                        "releaseId": self.release_id,
                        "releaseVersionId": self.revision_id,
                        "seconds": 3,
                    }
                ],
            ],
        )

    async def test_interval_crossing_utc_midnight_is_split_into_day_sessions(
        self,
    ) -> None:
        """Split an interval spanning UTC midnight into daily sessions."""
        started_at = self._millis(2026, 3, 4, 23, 59, 58) + 500
        ended_at = self._millis(2026, 3, 5, 0, 0, 2) + 500
        with self._activity() as request:
            result = await self._record(started_at, ended_at)

        self.assertEqual(result, {"ok": True, "data": None})
        self.assertEqual(
            [
                (session["date"], session["seconds"])
                for session in self._posts(request)[0]
            ],
            [("2026-03-04", 1), ("2026-03-05", 2)],
        )

    async def test_upload_splits_batches_at_one_thousand_sessions(self) -> None:
        """Send no more than one thousand sessions in each batch."""
        start = self._millis(2020, 1, 1, 0, 0, 0)
        with self._activity() as request:
            result = await self._record(start, start + 1_001 * 24 * 60 * 60 * 1000)

        self.assertEqual(result, {"ok": True, "data": None})
        self.assertEqual([len(batch) for batch in self._posts(request)], [1000, 1])

    async def test_partial_batch_success_is_never_sent_again_after_rejection(
        self,
    ) -> None:
        """Retain only a rejected batch suffix for a later retry."""
        start = self._millis(2020, 1, 1, 0, 0, 0)
        day = 24 * 60 * 60 * 1000
        with self._activity([204, 422, 204]) as request:
            rejected = await self._record(start, start + 1_001 * day)
            retried = await self._record(start, start + 1_001 * day)

        self.assertEqual(rejected, {"ok": False, "error": "httpError", "status": 422})
        self.assertEqual(retried, {"ok": True, "data": None})
        self.assertEqual([len(batch) for batch in self._posts(request)], [1000, 1, 1])

    async def test_same_release_interval_from_distinct_apps_does_not_deduplicate(
        self,
    ) -> None:
        """Preserve equal intervals recorded by distinct applications."""
        start = self._millis(2026, 3, 4, 12, 0, 0)
        with self._activity() as request:
            first = await self._record(start, start + 1_000, app_id=APP_ID)
            second = await self._record(start, start + 1_000, app_id=APP_ID + 1)

        self.assertEqual(first, {"ok": True, "data": None})
        self.assertEqual(second, {"ok": True, "data": None})
        self.assertEqual([len(batch) for batch in self._posts(request)], [1, 1])

    async def test_atomic_rejection_remains_retryable_without_restoration(self) -> None:
        """Keep an atomically rejected interval eligible for retry."""
        start = self._millis(2026, 3, 4, 12, 0, 0)
        with self._activity([422, 204]) as request:
            rejected = await self._record(start, start + 1_000)
            retried = await self._record(start, start + 1_000)

        self.assertEqual(rejected, {"ok": False, "error": "httpError", "status": 422})
        self.assertEqual(retried, {"ok": True, "data": None})
        self.assertEqual([len(batch) for batch in self._posts(request)], [1, 1])

    async def test_indeterminate_delivery_is_held_across_backend_recreation(
        self,
    ) -> None:
        """Keep an indeterminate interval held across backend recreation."""
        start = self._millis(2026, 3, 4, 12, 0, 0)
        with self._activity([None]) as request:
            unknown = await self._record(start, start + 1_000)
            recreated = activity_main.Plugin()
            held = await recreated.get_pending_playtime(STEAM_ID)
            retried = await self._record(start, start + 1_000, plugin=recreated)

        self.assertEqual(
            unknown, {"ok": False, "error": "deliveryUnknown", "status": 0}
        )
        self.assertEqual(held, [])
        self.assertEqual(
            retried, {"ok": False, "error": "deliveryUnknown", "status": 0}
        )
        self.assertEqual(len(self._posts(request)), 1)

    async def test_timeout_and_proxy_abort_are_held_as_indeterminate_delivery(
        self,
    ) -> None:
        """408 and nonstandard proxy 499 do not prove an atomic POST was rejected."""
        start = self._millis(2026, 3, 4, 12, 0, 0)
        for index, status in enumerate((408, 499)):
            interval_start = start + index * 2_000
            with self.subTest(status=status), self._activity([status]) as request:
                unknown = await self._record(interval_start, interval_start + 1_000)
                retried = await self._record(interval_start, interval_start + 1_000)

            self.assertEqual(
                unknown,
                {"ok": False, "error": "deliveryUnknown", "status": status},
            )
            self.assertEqual(
                retried,
                {"ok": False, "error": "deliveryUnknown", "status": 0},
            )
            self.assertEqual(len(self._posts(request)), 1)

    async def test_successful_rpc_retry_does_not_post_the_interval_twice(self) -> None:
        """Avoid reposting an interval after a successful RPC retry."""
        start = self._millis(2026, 3, 4, 12, 0, 0)
        with self._activity() as request:
            first = await self._record(start, start + 1_000)
            duplicate = await self._record(start, start + 1_000)

        self.assertEqual(first, {"ok": True, "data": None})
        self.assertEqual(duplicate, {"ok": True, "data": None})
        self.assertEqual(len(self._posts(request)), 1)

    async def test_first_bound_identity_survives_a_definite_retry(self) -> None:
        """Use the first bound identity when retrying a rejected interval."""
        start = self._millis(2026, 3, 4, 12, 0, 0)
        alternate = (
            "d0b1c2d3-1234-4abc-8def-0123456789ab",
            "e0b1c2d3-1234-4abc-8def-0123456789ab",
            "f0b1c2d3-1234-4abc-8def-0123456789ab",
        )
        with self._activity([422, 204]) as request:
            await self._record(start, start + 1_000)
            result = await self._record(start, start + 1_000, ids=alternate)

        self.assertEqual(result, {"ok": True, "data": None})
        self.assertEqual(self._posts(request)[1][0]["gameId"], self.game_id)

    async def test_invalid_timestamps_fail_before_network_or_queue_mutation(
        self,
    ) -> None:
        """Reject invalid timestamps before queueing or making requests."""
        for start, end in (
            (1.1, 2.1),
            (1.9, 1.1),
            (10**500, 10**500),
            (float("inf"), float("inf")),
            (float("nan"), 1),
        ):
            with (
                self.subTest(start=start, end=end),
                patch.object(activity_api, "request_json_status") as request,
            ):
                result = await self._record(start, end)

            self.assertEqual(
                result, {"ok": False, "error": "invalidRequest", "status": 0}
            )
            request.assert_not_called()
            self.assertEqual(await self.plugin.get_pending_playtime(STEAM_ID), [])

    async def test_signed_out_does_not_send_playtime(self) -> None:
        """Reject playtime uploads while the Activity session is signed out."""
        await self.plugin.sign_out_activity()
        start = self._millis(2026, 3, 4, 12, 0, 0)
        with patch.object(activity_api, "request_json_status") as request:
            result = await self._record(start, start + 1_000)

        self.assertEqual(result, {"ok": False, "error": "notSignedIn", "status": 0})
        request.assert_not_called()
