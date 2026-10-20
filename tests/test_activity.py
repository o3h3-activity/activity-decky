"""Behavioral coverage for activity."""

import asyncio
import threading
import unittest
from unittest.mock import patch

from backend_support import BackendTestCase, decky, make_authorization

from activity_backend.infrastructure import activity_transport as activity_api
from activity_backend.modules.activity import api as activity_proxy
from activity_backend.modules.activity.adapters.activity_api import ActivityApiEndpoint
from activity_backend.modules.activity.adapters.playtime_totals import (
    SettingsPlaytimeTotals,
)
from activity_backend.modules.authorization.adapters import token_store
from activity_backend.shared import HttpJsonResponse


class ActivityProxyTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Verify production comments and comment-mutation RPCs."""

    def setUp(self) -> None:
        """Build the proxy with isolated settings and session-ending callback."""
        super().setUp()
        self.api = activity_api.ActivityApiClient("https://activity.o3h3.com/api")
        self.token = "saved-token"
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: self.token,
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2999-10-27T00:00:00+00:00",
            }
        )
        self.authorization = make_authorization(self.settings())
        self.proxy = activity_proxy.ActivityProxy(
            ActivityApiEndpoint(self.api),
            self.authorization,
            decky.logger,
            SettingsPlaytimeTotals(self.settings()),
            self.authorization.get_user,
        )

    @staticmethod
    def _response(status: int, body: object) -> HttpJsonResponse:
        """Build a status response matching the shared HTTP boundary."""
        return HttpJsonResponse(status, body, 0)

    async def test_get_activity_requests_feed_for_release_version(self) -> None:
        """Request achievements and Steam BBCode comments for the release version."""
        game_id = "a0b1c2d3-1234-4abc-8def-0123456789ab"
        release_id = "b0b1c2d3-1234-4abc-8def-0123456789ab"
        revision_id = "c0b1c2d3-1234-4abc-8def-0123456789ab"
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=self._response(200, {"achievements": [], "comments": []}),
        ) as request:
            result = await self.proxy.get_activity(game_id, release_id, revision_id)

        self.assertEqual(
            result, {"ok": True, "data": {"achievements": [], "comments": []}}
        )
        request.assert_called_once_with(
            "https://activity.o3h3.com/api/v1/activity?gameId=a0b1c2d3-1234-4abc-8def-0123456789ab&releaseId=b0b1c2d3-1234-4abc-8def-0123456789ab&releaseVersionId=c0b1c2d3-1234-4abc-8def-0123456789ab&bodyFormat=steam-bbcode",
            method="GET",
            body=None,
            bearer_token=self.token,
        )

    async def test_get_activity_rejects_invalid_ids(self) -> None:
        """Reject each invalid production comments identity without HTTP."""
        valid_ids = (
            "a0b1c2d3-1234-4abc-8def-0123456789ab",
            "b0b1c2d3-1234-4abc-8def-0123456789ab",
            "c0b1c2d3-1234-4abc-8def-0123456789ab",
        )
        with patch.object(activity_api, "request_json_status") as request:
            for arguments in (
                ("not-a-uuid", valid_ids[1], valid_ids[2]),
                (valid_ids[0], "not-a-uuid", valid_ids[2]),
                (valid_ids[0], valid_ids[1], "not-a-uuid"),
            ):
                self.assertEqual(
                    await self.proxy.get_activity(*arguments),
                    {"ok": False, "error": "invalidRequest", "status": 0},
                )
        request.assert_not_called()

    async def test_get_friends_gameplay_requests_nested_release_version(
        self,
    ) -> None:
        """Request friends' gameplay at the game release version route."""
        game_id = "11111111-1234-4abc-8def-0123456789ab"
        release_id = "22222222-1234-4abc-8def-0123456789ab"
        revision_id = "a0b1c2d3-1234-4abc-8def-0123456789ab"
        body = [
            {
                "hasPlayed": True,
                "user": {
                    "userId": "friend",
                    "steamId": "76561198000000000",
                    "nickname": "Friend",
                    "avatarUrl": None,
                },
                "minutesPlayedLastTwoWeeks": 10,
                "minutesPlayedTotal": 20,
            }
        ]
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=self._response(200, body),
        ) as request:
            result = await self.proxy.get_friends_gameplay(
                game_id, release_id, revision_id
            )

        self.assertEqual(result, {"ok": True, "data": body})
        request.assert_called_once_with(
            f"https://activity.o3h3.com/api/v1/games/{game_id}/releases/{release_id}/versions/{revision_id}/friends",
            method="GET",
            body=None,
            bearer_token=self.token,
        )

    async def test_get_friends_gameplay_rejects_invalid_route_ids_without_http(
        self,
    ) -> None:
        """Every identifier in the friends route must be a UUID."""
        valid_id = "0f1e2d3c-1234-4abc-8def-0123456789ab"
        failure = {"ok": False, "error": "invalidRequest", "status": 0}
        with patch.object(activity_api, "request_json_status") as request:
            for invalid_id in (None, "", "not-a-uuid"):
                for index in range(3):
                    identifiers: list[object] = [valid_id, valid_id, valid_id]
                    identifiers[index] = invalid_id
                    with self.subTest(index=index, value=invalid_id):
                        self.assertEqual(
                            await self.proxy.get_friends_gameplay(*identifiers),
                            failure,
                        )
        request.assert_not_called()

    async def test_post_comment_sends_steam_bbcode_body(self) -> None:
        """Address the release version in the route and send only comment content."""
        game_id = "11111111-1234-4abc-8def-0123456789ab"
        release_id = "0f1e2d3c-1234-4abc-8def-0123456789ab"
        revision_id = "a0b1c2d3-1234-4abc-8def-0123456789ab"
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=self._response(201, {"id": "comment"}),
        ) as request:
            result = await self.proxy.post_comment(
                game_id, release_id, revision_id, " hello "
            )

        self.assertEqual(result, {"ok": True, "data": {"id": "comment"}})
        request.assert_called_once_with(
            f"https://activity.o3h3.com/api/v1/games/{game_id}/releases/{release_id}/versions/{revision_id}/comments",
            method="POST",
            body={
                "body": " hello ",
                "bodyFormat": "steam-bbcode",
            },
            bearer_token=self.token,
        )

    async def test_comment_mutations_reject_invalid_route_ids_without_http(
        self,
    ) -> None:
        """Every identifier in the version-scoped route must be a UUID."""
        valid_id = "0f1e2d3c-1234-4abc-8def-0123456789ab"
        failure = {"ok": False, "error": "invalidRequest", "status": 0}
        with patch.object(activity_api, "request_json_status") as request:
            for invalid_id in (None, "", "not-a-uuid"):
                for index in range(3):
                    identifiers: list[object] = [valid_id, valid_id, valid_id]
                    identifiers[index] = invalid_id
                    with self.subTest(index=index, value=invalid_id):
                        self.assertEqual(
                            await self.proxy.post_comment(*identifiers, "hi"), failure
                        )
                        self.assertEqual(
                            await self.proxy.delete_comment(*identifiers, valid_id),
                            failure,
                        )
                self.assertEqual(
                    await self.proxy.delete_comment(
                        valid_id, valid_id, valid_id, invalid_id
                    ),
                    failure,
                )
        request.assert_not_called()

    async def test_delete_comment_maps_empty_success_to_null(self) -> None:
        """Return a successful null payload for a 204 deletion."""
        game_id = "11111111-1234-4abc-8def-0123456789ab"
        release_id = "22222222-1234-4abc-8def-0123456789ab"
        revision_id = "33333333-1234-4abc-8def-0123456789ab"
        comment_id = "0f1e2d3c-1234-4abc-8def-0123456789ab"
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=self._response(204, None),
        ) as request:
            result = await self.proxy.delete_comment(
                game_id, release_id, revision_id, comment_id
            )

        self.assertEqual(result, {"ok": True, "data": None})
        request.assert_called_once_with(
            f"https://activity.o3h3.com/api/v1/games/{game_id}/releases/{release_id}/versions/{revision_id}/comments/{comment_id}",
            method="DELETE",
            body=None,
            bearer_token=self.token,
        )

    async def test_stale_comments_401_preserves_a_replacement_session(self) -> None:
        """Do not sign out a replacement token when an older request is rejected."""
        request_started = threading.Event()
        release_request = threading.Event()

        def rejected_response(_: str, **__: object) -> HttpJsonResponse:
            request_started.set()
            if not release_request.wait(timeout=5):
                raise TimeoutError("Comments request was not released")
            return self._response(401, {"error": "unauthorized"})

        with patch.object(
            activity_api, "request_json_status", side_effect=rejected_response
        ):
            request = asyncio.create_task(
                self.proxy.get_activity(
                    "a0b1c2d3-1234-4abc-8def-0123456789ab",
                    "b0b1c2d3-1234-4abc-8def-0123456789ab",
                    "c0b1c2d3-1234-4abc-8def-0123456789ab",
                )
            )
            try:
                self.assertTrue(await asyncio.to_thread(request_started.wait, 5))
                self.settings().update(
                    {token_store.ACCESS_TOKEN_SETTING: "replacement-token"}
                )
            finally:
                release_request.set()
                result = await request

        self.assertEqual(result, {"ok": False, "error": "unauthorized", "status": 401})
        self.assertEqual(self.authorization.access_token(), "replacement-token")
        self.assertEqual(self.authorization.get_state()["status"], "signedIn")

    async def test_comments_401_removes_the_current_session(self) -> None:
        """A rejected current credential must stop subsequent authenticated calls."""
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=self._response(401, {"error": "unauthorized"}),
        ):
            result = await self.proxy.get_activity(
                "a0b1c2d3-1234-4abc-8def-0123456789ab",
                "b0b1c2d3-1234-4abc-8def-0123456789ab",
                "c0b1c2d3-1234-4abc-8def-0123456789ab",
            )

        self.assertEqual(result, {"ok": False, "error": "unauthorized", "status": 401})
        self.assertIsNone(self.authorization.access_token())
        self.assertEqual(self.authorization.get_state()["status"], "signedOut")

    async def test_comments_failures_preserve_error_classification_and_session(
        self,
    ) -> None:
        """Distinguish unavailable, HTTP, and malformed responses without signing out."""
        for response, error, status in (
            (None, "unreachable", 0),
            (self._response(503, {"error": "unavailable"}), "httpError", 503),
            (self._response(200, None), "invalidResponse", 200),
        ):
            with self.subTest(error=error):
                with patch.object(
                    activity_api, "request_json_status", return_value=response
                ):
                    result = await self.proxy.get_activity(
                        "a0b1c2d3-1234-4abc-8def-0123456789ab",
                        "b0b1c2d3-1234-4abc-8def-0123456789ab",
                        "c0b1c2d3-1234-4abc-8def-0123456789ab",
                    )

                self.assertEqual(
                    result, {"ok": False, "error": error, "status": status}
                )
                self.assertEqual(self.authorization.access_token(), self.token)
