"""Behavioral coverage for durable release-version playtime recording."""

import asyncio
import math
import threading
import unittest
from datetime import UTC, datetime
from unittest.mock import patch
from urllib.parse import urlsplit

from backend_support import BackendTestCase, activity_main

from activity_backend.infrastructure import activity_transport as activity_api
from activity_backend.modules.authorization.adapters import token_store
from activity_backend.shared import HttpJsonResponse


class PlaytimeTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Verify Plugin records durable UTC-day release-version playtime totals."""

    game_id = "a0b1c2d3-1234-4abc-8def-0123456789ab"
    release_id = "b0b1c2d3-1234-4abc-8def-0123456789ab"
    revision_id = "c0b1c2d3-1234-4abc-8def-0123456789ab"

    def setUp(self) -> None:
        """Create one signed-in Plugin against an isolated settings file."""
        super().setUp()
        self.plugin = activity_main.Plugin()
        self._set_token(self.plugin, "account-a-token")

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

    @staticmethod
    def _user(steam_id: str) -> dict[str, object]:
        """Build the authenticated account response used for durable scoping."""
        return {
            "nickname": steam_id,
            "avatarUrl": None,
            "steamId": steam_id,
        }

    @staticmethod
    def _put_calls(calls: list[tuple[str, dict[str, object]]]) -> list[tuple[str, int]]:
        """Extract the API UTC day and cumulative seconds from captured PUTs."""
        return [
            (urlsplit(url).path.rsplit("/", 1)[-1], details["body"]["seconds"])
            for url, details in calls
            if details["method"] == "PUT"
        ]

    async def test_same_day_intervals_replace_the_cumulative_total(self) -> None:
        """Two committed intervals upload increasingly cumulative, floored seconds."""
        calls: list[tuple[str, dict[str, object]]] = []

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            calls.append((url, details))
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user("account-a"))
            return self._response(204)

        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ):
            first = await self.plugin.record_playtime(
                self.game_id, self.release_id, self.revision_id, start, start + 1_300
            )
            second = await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                start + 10_000,
                start + 12_700,
            )

        self.assertEqual(first, {"ok": True, "data": None})
        self.assertEqual(second, {"ok": True, "data": None})
        self.assertEqual(self._put_calls(calls), [("2026-03-04", 1), ("2026-03-04", 4)])

    async def test_interval_crossing_utc_midnight_replaces_each_day_total(self) -> None:
        """Split an interval exactly at the UTC day boundary before uploading totals."""
        calls: list[tuple[str, dict[str, object]]] = []

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            calls.append((url, details))
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user("account-a"))
            return self._response(204)

        started_at = self._millis(2026, 3, 4, 23, 59, 58, 500_000)
        ended_at = self._millis(2026, 3, 5, 0, 0, 2, 500_000)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ):
            result = await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                started_at,
                ended_at,
            )

        self.assertEqual(result, {"ok": True, "data": None})
        self.assertEqual(self._put_calls(calls), [("2026-03-04", 1), ("2026-03-05", 2)])

    async def test_totals_survive_backend_recreation(self) -> None:
        """A new Plugin instance continues totals persisted by its predecessor."""
        calls: list[tuple[str, dict[str, object]]] = []

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            calls.append((url, details))
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user("account-a"))
            return self._response(204)

        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ):
            self.assertEqual(
                await self.plugin.record_playtime(
                    self.game_id,
                    self.release_id,
                    self.revision_id,
                    start,
                    start + 1_500,
                ),
                {"ok": True, "data": None},
            )
            recreated = activity_main.Plugin()
            self.assertEqual(
                await recreated.record_playtime(
                    self.game_id,
                    self.release_id,
                    self.revision_id,
                    start + 5_000,
                    start + 6_500,
                ),
                {"ok": True, "data": None},
            )

        self.assertEqual(self._put_calls(calls), [("2026-03-04", 1), ("2026-03-04", 3)])

    async def test_concurrent_commits_wait_for_the_prior_put_before_replacing_total(
        self,
    ) -> None:
        """Keep a later total from reaching the API before the prior PUT commits."""
        calls: list[tuple[str, dict[str, object]]] = []
        first_put_started = threading.Event()
        release_first_put = threading.Event()
        second_put_started = threading.Event()
        put_count = 0

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            nonlocal put_count
            calls.append((url, details))
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user("account-a"))
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
        ):
            first = asyncio.create_task(
                self.plugin.record_playtime(
                    self.game_id,
                    self.release_id,
                    self.revision_id,
                    start,
                    start + 1_000,
                )
            )
            try:
                self.assertTrue(await asyncio.to_thread(first_put_started.wait, 5))
                second = asyncio.create_task(
                    self.plugin.record_playtime(
                        self.game_id,
                        self.release_id,
                        self.revision_id,
                        start + 2_000,
                        start + 4_000,
                    )
                )
                self.assertFalse(await asyncio.to_thread(second_put_started.wait, 0.1))
            finally:
                release_first_put.set()
            results = await asyncio.gather(first, second)

        self.assertEqual(results, [{"ok": True, "data": None}] * 2)
        self.assertEqual(self._put_calls(calls), [("2026-03-04", 1), ("2026-03-04", 3)])

    async def test_totals_are_scoped_by_steam_account_not_bearer_token(
        self,
    ) -> None:
        """A token replacement retains its total; a different account starts clean."""
        calls: list[tuple[str, dict[str, object]]] = []
        users = {
            "account-a-token": "76561198000000001",
            "account-a-replacement-token": "76561198000000001",
            "account-b-token": "76561198000000002",
        }

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            calls.append((url, details))
            if urlsplit(url).path == "/api/v1/me":
                steam_id = users[details["bearer_token"]]
                return self._response(
                    200,
                    {
                        "nickname": "Shared nickname",
                        "avatarUrl": None,
                        "steamId": steam_id,
                    },
                )
            return self._response(204)

        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ):
            await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                start,
                start + 1_500,
            )
            self._set_token(self.plugin, "account-a-replacement-token")
            await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                start + 3_000,
                start + 4_500,
            )
            self._set_token(self.plugin, "account-b-token")
            result = await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                start + 6_000,
                start + 7_500,
            )

        self.assertEqual(result, {"ok": True, "data": None})
        self.assertEqual(
            self._put_calls(calls),
            [("2026-03-04", 1), ("2026-03-04", 3), ("2026-03-04", 1)],
        )

    async def test_missing_steam_id_never_falls_back_to_a_token_scoped_total(
        self,
    ) -> None:
        """Refuse recording without the current account's stable identifier."""
        calls: list[tuple[str, dict[str, object]]] = []

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            calls.append((url, details))
            return self._response(
                200,
                {
                    "nickname": "No stable identifier",
                    "avatarUrl": None,
                    "steamId": None,
                },
            )

        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ):
            result = await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                start,
                start + 1_000,
            )

        self.assertEqual(result, {"ok": False, "error": "invalidResponse", "status": 0})
        self.assertEqual(
            [urlsplit(url).path for url, _ in calls],
            ["/api/v1/me"],
        )

    async def test_invalid_ids_and_timestamps_do_not_make_http_requests(
        self,
    ) -> None:
        """Reject malformed RPC input before looking up an account or writing totals."""
        valid_start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        invalid_requests = (
            (
                "not-a-uuid",
                self.release_id,
                self.revision_id,
                valid_start,
                valid_start + 1,
            ),
            (
                self.game_id,
                None,
                self.revision_id,
                valid_start,
                valid_start + 1,
            ),
            (
                self.game_id,
                self.release_id,
                "not-a-uuid",
                valid_start,
                valid_start + 1,
            ),
            (
                self.game_id,
                self.release_id,
                self.revision_id,
                True,
                valid_start + 1,
            ),
            (
                self.game_id,
                self.release_id,
                self.revision_id,
                valid_start,
                math.nan,
            ),
            (
                self.game_id,
                self.release_id,
                self.revision_id,
                valid_start + 1,
                valid_start,
            ),
        )
        with patch.object(activity_api, "request_json_status") as request:
            for arguments in invalid_requests:
                with self.subTest(arguments=arguments):
                    self.assertEqual(
                        await self.plugin.record_playtime(*arguments),
                        {"ok": False, "error": "invalidRequest", "status": 0},
                    )

        request.assert_not_called()

    async def test_failed_put_keeps_total_for_the_next_committed_interval(self) -> None:
        """A transient failed replacement does not discard locally accumulated time."""
        calls: list[tuple[str, dict[str, object]]] = []
        put_count = 0

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            nonlocal put_count
            calls.append((url, details))
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user("account-a"))
            put_count += 1
            return self._response(503 if put_count == 1 else 204, {})

        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ):
            failed = await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                start,
                start + 1_500,
            )
            succeeded = await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                start + 5_000,
                start + 6_500,
            )

        self.assertEqual(failed, {"ok": False, "error": "httpError", "status": 503})
        self.assertEqual(succeeded, {"ok": True, "data": None})
        self.assertEqual(self._put_calls(calls), [("2026-03-04", 1), ("2026-03-04", 3)])

    async def test_empty_success_is_accepted_and_401_ends_the_current_session(
        self,
    ) -> None:
        """Map the replacement status and invalidate the rejected current credential."""
        calls: list[tuple[str, dict[str, object]]] = []
        put_responses = [
            self._response(204),
            self._response(401, {"error": "unauthorized"}),
        ]

        def request_json_status(url: str, **details: object) -> HttpJsonResponse:
            calls.append((url, details))
            if urlsplit(url).path == "/api/v1/me":
                return self._response(200, self._user("account-a"))
            return put_responses.pop(0)

        start = self._millis(2026, 3, 4, 12, 0, 0, 0)
        with patch.object(
            activity_api, "request_json_status", side_effect=request_json_status
        ):
            successful = await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                start,
                start + 1_000,
            )
            rejected = await self.plugin.record_playtime(
                self.game_id,
                self.release_id,
                self.revision_id,
                start + 2_000,
                start + 3_000,
            )

        self.assertEqual(successful, {"ok": True, "data": None})
        self.assertEqual(
            rejected,
            {"ok": False, "error": "unauthorized", "status": 401},
        )
        self.assertIsNone(self.plugin.backend.authorization.access_token())
        self.assertEqual(
            self.plugin.backend.authorization.get_state()["status"], "signedOut"
        )
        self.assertEqual(self._put_calls(calls), [("2026-03-04", 1), ("2026-03-04", 2)])
