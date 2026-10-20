"""Behavioral coverage for authorization."""

import asyncio
import threading
import unittest
from unittest.mock import patch

from backend_support import BackendTestCase, decky, make_authorization

from activity_backend.infrastructure import activity_transport as activity_api
from activity_backend.modules.authorization.adapters import device_endpoint, token_store
from activity_backend.modules.authorization.api import RetroAchievementsCredentials
from activity_backend.shared import HttpJsonResponse


class DeviceAuthorizationTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Verify Activity device authorization state, polling, and token persistence."""

    def setUp(self) -> None:
        """Create a deterministic polling client."""
        super().setUp()
        decky.emit.reset_mock()
        self.now = 0.0
        self.sleeps: list[float] = []

        async def sleep(seconds: float) -> None:
            self.sleeps.append(seconds)
            self.now += seconds

        self.client = make_authorization(
            self.settings(),
            clock=lambda: self.now,
            sleep=sleep,
            wall_clock=lambda: 1_000.0 + self.now,
        )

        self.start_body = {
            "deviceCode": "a" * 64,
            "userCode": "BCDF-GHJK",
            "verificationUri": "http://localhost:3000/device",
            "verificationUriComplete": "http://localhost:3000/device?code=BCDF-GHJK",
            "expiresIn": 600,
            "interval": 5,
        }

    @staticmethod
    def _response(
        status: int, body: object, retry_after_seconds: int = 0
    ) -> HttpJsonResponse:
        """Build a status response matching the shared HTTP boundary."""
        return HttpJsonResponse(status, body, retry_after_seconds)

    async def _start_and_wait(self) -> None:
        """Start polling and await its terminal task."""
        await self.client.start()
        self.assertIsNotNone(self.client._task)
        await self.client._task

    async def test_slow_down_increases_the_next_poll_interval(self) -> None:
        """Add the RFC slow-down interval before the following token request."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "0" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, {"status": "slow_down"}),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        self.assertEqual(self.sleeps, [5, 10])

    async def test_poll_rate_limit_uses_retry_after_for_the_next_interval(self) -> None:
        """Honor a longer server-directed rate-limit delay."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "0" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(429, {"error": "rate_limited"}, 20),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        self.assertEqual(self.sleeps, [5, 20])

    async def test_transient_failures_use_capped_exponential_backoff(self) -> None:
        """Increase only the transient-failure delay until its configured cap."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "0" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                None,
                self._response(500, {"error": "unavailable"}),
                self._response(500, {"error": "unavailable"}),
                self._response(500, {"error": "unavailable"}),
                self._response(500, {"error": "unavailable"}),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        self.assertEqual(self.sleeps, [5, 10, 15, 25, 45, 65])
        self.assertEqual(
            [delay - self.start_body["interval"] for delay in self.sleeps[1:]],
            [5, 10, 20, 40, 60],
        )

    async def test_non_5xx_response_resets_only_failure_backoff(self) -> None:
        """Keep the grant interval while dropping transient-failure delay."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "0" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, {"status": "slow_down"}),
                None,
                self._response(200, {"status": "pending"}),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        self.assertEqual(self.sleeps, [5, 10, 20, 10])

    async def test_token_limit_instruction_keeps_polling(self) -> None:
        """Publish the revocation instruction and continue the same grant."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "0" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(409, {"error": "token_limit"}),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        self.assertEqual(self.sleeps, [5, 5])
        self.assertEqual(self.client.get_state()["status"], "signedIn")
        emitted_states = [call.args[1] for call in decky.emit.call_args_list]
        self.assertTrue(
            any(
                state["status"] == "pending"
                and "http://localhost:3000/settings/access-tokens" in state["message"]
                for state in emitted_states
            )
        )

    async def test_pending_state_publishes_code_expiry_and_access_tokens_url(
        self,
    ) -> None:
        """Publish the wall-clock code expiry and Activity access-tokens URL."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "0" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, {"status": "pending"}),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        pending = [
            call.args[1]
            for call in decky.emit.call_args_list
            if call.args[1]["status"] == "pending"
        ]
        self.assertEqual(
            [state["codeExpiresAt"] for state in pending],
            [1_600_000, 1_600_000],
        )
        self.assertTrue(
            all(
                state["accessTokensUrl"]
                == "http://localhost:3000/settings/access-tokens"
                for state in pending
            )
        )
        final_state = self.client.get_state()
        self.assertEqual(final_state["status"], "signedIn")
        self.assertEqual(final_state["codeExpiresAt"], 0)
        self.assertEqual(final_state["accessTokensUrl"], "")

    async def test_valid_approval_persists_token_and_expiry_together(self) -> None:
        """Save a valid bearer token and expiry after the exact token request."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "0" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, approved),
            ],
        ) as request:
            await self._start_and_wait()

        self.assertEqual(
            self.settings().get(token_store.ACCESS_TOKEN_SETTING, str),
            approved["accessToken"],
        )
        self.assertEqual(
            self.settings().get(token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING, str),
            approved["expiresAt"],
        )
        self.assertEqual(self.client.get_state()["status"], "signedIn")
        token_request = request.call_args_list[-1]
        self.assertEqual(
            token_request.args,
            ("https://activity.o3h3.com/api/v1/auth/device/token",),
        )
        self.assertEqual(
            token_request.kwargs,
            {
                "method": "POST",
                "body": {"deviceCode": "a" * 64},
                "bearer_token": None,
            },
        )

    async def test_approval_persists_retro_achievements_credentials_with_session(
        self,
    ) -> None:
        """Store approved RetroAchievements credentials only with their bearer session."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "2" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
            "retroAchievements": {"userName": "DeckPlayer", "apiKey": "ra-secret"},
        }
        self.settings().update(
            {
                "retroAchievementsUsername": "legacy-player",
                "retroAchievementsApiKey": "legacy-secret",
            }
        )
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        credentials = self.client.retro_achievements_credentials()
        self.assertIsInstance(credentials, RetroAchievementsCredentials)
        self.assertEqual(credentials.username, "DeckPlayer")
        self.assertEqual(credentials.api_key, "ra-secret")
        self.assertNotIn("DeckPlayer", repr(credentials))
        self.assertNotIn("ra-secret", repr(credentials))
        self.assertEqual(
            self.settings().get("activityRetroAchievements", dict),
            {"userName": "DeckPlayer", "apiKey": "ra-secret"},
        )
        self.assertIsNone(self.settings().get("retroAchievementsUsername", str))
        self.assertIsNone(self.settings().get("retroAchievementsApiKey", str))
        self.assertTrue(self.client.get_state()["retroAchievementsLinked"])

    async def test_approval_without_retro_achievements_replaces_old_credentials(
        self,
    ) -> None:
        """Keep an Activity-only approval free of credentials from its old session."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "3" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }
        self.settings().update(
            {
                "activityRetroAchievements": {
                    "userName": "OldPlayer",
                    "apiKey": "old-secret",
                },
                "retroAchievementsUsername": "legacy-player",
                "retroAchievementsApiKey": "legacy-secret",
            }
        )
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        self.assertIsNone(self.client.retro_achievements_credentials())
        self.assertIsNone(self.settings().get("activityRetroAchievements", dict))
        self.assertIsNone(self.settings().get("retroAchievementsUsername", str))
        self.assertIsNone(self.settings().get("retroAchievementsApiKey", str))
        self.assertFalse(self.client.get_state()["retroAchievementsLinked"])

    async def test_approval_with_null_retro_achievements_is_activity_only(self) -> None:
        """Accept an explicit null RetroAchievements credential bundle."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "4" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
            "retroAchievements": None,
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        self.assertEqual(self.client.get_state()["status"], "signedIn")
        self.assertIsNone(self.client.retro_achievements_credentials())

    async def test_approval_rejects_malformed_retro_achievements_credentials(
        self,
    ) -> None:
        """Reject credential bundles unless both required fields are nonblank strings."""
        malformed_credentials = (
            {},
            {"userName": "", "apiKey": "ra-secret"},
            {"userName": "DeckPlayer", "apiKey": " "},
            {"userName": "DeckPlayer", "apiKey": None},
            "not-an-object",
        )
        for retro_achievements in malformed_credentials:
            with self.subTest(retro_achievements=retro_achievements):
                approved = {
                    "status": "approved",
                    "accessToken": "pat_" + "5" * 64,
                    "tokenType": "Bearer",
                    "expiresAt": "2998-10-27T00:00:00+00:00",
                    "retroAchievements": retro_achievements,
                }
                with patch.object(
                    activity_api,
                    "request_json_status",
                    side_effect=[
                        self._response(201, self.start_body),
                        self._response(200, approved),
                    ],
                ):
                    await self._start_and_wait()

                self.assertEqual(self.client.get_state()["status"], "error")
                self.assertIsNone(self.client.retro_achievements_credentials())
                self.assertIsNone(
                    self.settings().get("activityRetroAchievements", dict)
                )

    async def test_authorization_state_and_events_hide_retro_achievements_secrets(
        self,
    ) -> None:
        """Keep approved RetroAchievements values out of every frontend snapshot."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "6" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
            "retroAchievements": {"userName": "DeckPlayer", "apiKey": "ra-secret"},
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        states = [self.client.get_state()]
        states.extend(call.args[1] for call in decky.emit.call_args_list)
        for state in states:
            with self.subTest(state=state):
                self.assertNotIn("retroAchievements", state)
                self.assertNotIn("DeckPlayer", state.values())
                self.assertNotIn("ra-secret", state.values())

    async def test_approval_accepts_nonempty_bearer_tokens_case_insensitively(
        self,
    ) -> None:
        """Persist any non-empty bearer access token accepted by the API contract."""
        approved = {
            "status": "approved",
            "accessToken": "opaque token",
            "tokenType": "bearer",
            "expiresAt": "2999-10-27T00:00:00+00:00",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, approved),
            ],
        ):
            await self._start_and_wait()

        self.assertEqual(
            self.settings().get(token_store.ACCESS_TOKEN_SETTING, str),
            "opaque token",
        )

    async def test_approval_rejects_missing_token_type_and_invalid_expiry(self) -> None:
        """Keep required approval fields and timezone-aware expiry validation."""
        for token_type, expires_at in (
            (None, "2999-10-27T00:00:00+00:00"),
            ("Bearer", "2999-10-27"),
        ):
            with self.subTest(token_type=token_type, expires_at=expires_at):
                approved = {
                    "status": "approved",
                    "accessToken": "opaque token",
                    "expiresAt": expires_at,
                }
                if token_type is not None:
                    approved["tokenType"] = token_type
                with patch.object(
                    activity_api,
                    "request_json_status",
                    side_effect=[
                        self._response(201, self.start_body),
                        self._response(200, approved),
                    ],
                ):
                    await self._start_and_wait()

                self.assertEqual(self.client.get_state()["status"], "error")
                self.assertIsNone(
                    self.settings().get(token_store.ACCESS_TOKEN_SETTING, str)
                )

    async def test_start_rejects_malformed_required_grant_fields(self) -> None:
        """Reject grants missing required values or using invalid positive intervals."""
        invalid_grants = (
            {},
            dict(self.start_body, deviceCode=""),
            dict(self.start_body, userCode=1),
            dict(self.start_body, verificationUriComplete=None),
            dict(self.start_body, expiresIn=True),
            dict(self.start_body, expiresIn=0),
            dict(self.start_body, interval=False),
            dict(self.start_body, interval=-1),
        )
        for body in invalid_grants:
            with self.subTest(body=body):
                with patch.object(
                    activity_api,
                    "request_json_status",
                    return_value=self._response(201, body),
                ):
                    await self._start_and_wait()

                self.assertEqual(self.client.get_state()["status"], "error")
                self.assertIsNone(
                    self.settings().get(token_store.ACCESS_TOKEN_SETTING, str)
                )

    async def test_expired_saved_token_is_removed_and_starts_signed_out(self) -> None:
        """Treat an expired saved credential as absent before authorizing requests."""
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: "expired-token",
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2000-01-01T00:00:00+00:00",
                "activityRetroAchievements": {
                    "userName": "DeckPlayer",
                    "apiKey": "ra-secret",
                },
            }
        )
        client = make_authorization(self.settings())

        self.assertEqual(client.get_state()["status"], "signedOut")
        self.assertIsNone(client.access_token())
        self.assertIsNone(self.settings().get(token_store.ACCESS_TOKEN_SETTING, str))
        self.assertIsNone(
            self.settings().get(token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING, str)
        )
        self.assertIsNone(self.settings().get("activityRetroAchievements", dict))

    async def test_sign_out_clears_retro_achievements_credentials_with_session(
        self,
    ) -> None:
        """Remove RetroAchievements credentials whenever the Activity session ends."""
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: "saved-token",
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2999-01-01T00:00:00+00:00",
                "activityRetroAchievements": {
                    "userName": "DeckPlayer",
                    "apiKey": "ra-secret",
                },
            }
        )

        await self.client.sign_out()

        self.assertIsNone(self.client.retro_achievements_credentials())
        self.assertIsNone(self.settings().get("activityRetroAchievements", dict))

    async def test_sign_out_removes_all_persisted_game_recognitions(self) -> None:
        """Do not retain positive or negative recognition entries across sessions."""
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: "saved-token",
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2999-01-01T00:00:00+00:00",
                "gameRecognitions": {
                    "a" * 32: {"gameId": "recognized-game", "checkedAt": 1_000},
                    "b" * 32: {"gameId": None, "checkedAt": 1_000},
                },
                "unrelatedSetting": "preserved",
            }
        )

        state = await self.client.sign_out()

        self.assertEqual(state["status"], "signedOut")
        self.assertIsNone(self.settings().get("gameRecognitions", dict))
        self.assertEqual(self.settings().get("unrelatedSetting", str), "preserved")

    async def test_authorization_snapshot_rechecks_a_token_that_expired_after_login(
        self,
    ) -> None:
        """Do not let the frontend dispatch protected RPCs using stale signed-in state."""
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: "saved-token",
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2999-01-01T00:00:00+00:00",
            }
        )
        client = make_authorization(self.settings())
        self.assertEqual(client.get_state()["status"], "signedIn")
        self.settings().update(
            {token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2000-01-01T00:00:00+00:00"}
        )

        with patch.object(activity_api, "request_json_status") as request:
            self.assertEqual(client.get_state()["status"], "signedOut")
        request.assert_not_called()
        self.assertIsNone(self.settings().get(token_store.ACCESS_TOKEN_SETTING, str))

    async def test_start_rate_limit_blocks_requests_until_retry_deadline(self) -> None:
        """Reject early starts locally and resume exactly at the retry deadline."""
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "0" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(429, {"error": "rate_limited"}, 20),
                self._response(201, self.start_body),
                self._response(200, approved),
            ],
        ) as request:
            await self.client.start()
            first_task = self.client._task
            self.assertIsNotNone(first_task)
            await first_task

            await self.client.start()
            self.assertEqual(request.call_count, 1)
            self.assertEqual(self.client.get_state()["status"], "error")

            self.now = 20
            await self.client.start()
            task = self.client._task
            self.assertIsNotNone(task)
            await task

        start_url = "https://activity.o3h3.com/api/v1/auth/device"
        self.assertEqual(
            [call.args[0] for call in request.call_args_list].count(start_url), 2
        )

    async def test_deadline_stops_without_polling_after_expiration(self) -> None:
        """Sleep only to the deadline and do not send a post-expiry token poll."""
        self.start_body["expiresIn"] = 12
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(200, {"status": "pending"}),
                self._response(200, {"status": "pending"}),
            ],
        ) as request:
            await self._start_and_wait()

        self.assertEqual(self.sleeps, [5, 5, 2])
        self.assertEqual(request.call_count, 3)
        self.assertEqual(self.client.get_state()["status"], "expired")

    async def test_late_approval_expires_without_persisting_or_restarting(self) -> None:
        """Discard a token response received at the grant deadline."""
        self.start_body["expiresIn"] = 6
        approved = {
            "status": "approved",
            "accessToken": "pat_" + "0" * 64,
            "tokenType": "Bearer",
            "expiresAt": "2998-10-27T00:00:00+00:00",
        }

        def request_json_status(url: str, **_: object) -> HttpJsonResponse:
            """Advance the deterministic clock while returning the late approval."""
            if url.endswith(device_endpoint.DEVICE_START_PATH):
                return self._response(201, self.start_body)
            self.now += 1
            return self._response(200, approved)

        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=request_json_status,
        ) as request:
            await self._start_and_wait()

        self.assertEqual(self.sleeps, [5])
        self.assertEqual(request.call_count, 2)
        self.assertEqual(self.client.get_state()["status"], "expired")
        self.assertIsNone(self.settings().get(token_store.ACCESS_TOKEN_SETTING, str))
        self.assertIsNone(
            self.settings().get(token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING, str)
        )

    async def test_missing_grant_restarts_with_a_fresh_code(self) -> None:
        """Restart authorization when the API reports that a device grant disappeared."""
        second_start = dict(self.start_body, userCode="LMNP-QRST")
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                self._response(201, self.start_body),
                self._response(404, {"error": "gone"}),
                self._response(201, second_start),
                self._response(200, {"status": "denied"}),
            ],
        ) as request:
            await self._start_and_wait()

        start_url = "https://activity.o3h3.com/api/v1/auth/device"
        self.assertEqual(
            [call.args[0] for call in request.call_args_list].count(start_url), 2
        )
        self.assertEqual(self.client.get_state()["status"], "denied")
        statuses = [call.args[1]["status"] for call in decky.emit.call_args_list]
        self.assertEqual(
            statuses,
            ["starting", "pending", "starting", "pending", "denied"],
        )

    async def test_poll_rejects_malformed_or_unknown_statuses(self) -> None:
        """End authorization on responses without a recognized poll status."""
        malformed_bodies = (
            None,
            {},
            {"status": 1},
            {"status": []},
            {"status": "unexpected"},
        )
        for body in malformed_bodies:
            with self.subTest(body=body):
                with patch.object(
                    activity_api,
                    "request_json_status",
                    side_effect=[
                        self._response(201, self.start_body),
                        self._response(200, body),
                    ],
                ):
                    await self._start_and_wait()

                self.assertEqual(self.client.get_state()["status"], "error")

    async def test_concurrent_starts_leave_one_current_worker(self) -> None:
        """Serialize starts so the replacement worker is the only current task."""

        async def wait_forever() -> None:
            """Keep each mock worker active until lifecycle cancellation."""
            await asyncio.Event().wait()

        with patch.object(self.client, "_run", side_effect=wait_forever):
            await asyncio.gather(self.client.start(), self.client.start())
            task = self.client._task
            self.assertIsNotNone(task)
            self.assertFalse(task.done())

            await self.client.cancel()

        self.assertIsNone(self.client._task)
        with self.assertRaises(asyncio.CancelledError):
            await task

    async def test_cancel_drains_an_inflight_blocking_request(self) -> None:
        """Wait for a worker request to finish before replacing its task."""
        request_started = threading.Event()
        release_request = threading.Event()

        def request_json_status(_: str, **__: object) -> HttpJsonResponse:
            request_started.set()
            release_request.wait(timeout=5)
            return self._response(201, self.start_body)

        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=request_json_status,
        ):
            await self.client.start()
            self.assertTrue(await asyncio.to_thread(request_started.wait, 5))
            cancel_task = asyncio.create_task(self.client.cancel())
            await asyncio.sleep(0)
            self.assertFalse(cancel_task.done())
            release_request.set()
            await cancel_task

        self.assertEqual(self.client.get_state()["status"], "signedOut")

    async def test_get_user_returns_optional_steam_id(self) -> None:
        """Expose a non-empty SteamID64 from the current-user response."""
        token = "saved-token"
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: token,
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2999-10-27T00:00:00+00:00",
            }
        )
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=self._response(
                200,
                {
                    "avatarUrl": "https://avatar.example",
                    "nickname": "Player",
                    "steamId": "76561198000000000",
                    "retroAchievements": {
                        "userName": "DeckPlayer",
                        "apiKey": "ra-secret",
                    },
                },
            ),
        ):
            user = await self.client.get_user()

        self.assertEqual(
            user,
            {
                "avatarUrl": "https://avatar.example",
                "nickname": "Player",
                "steamId": "76561198000000000",
            },
        )

    async def test_get_user_tolerates_optional_fields_but_requires_nickname(
        self,
    ) -> None:
        """Return normalized optional fields and reject a missing or invalid nickname."""
        token = "saved-token"
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: token,
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2999-10-27T00:00:00+00:00",
            }
        )
        for body, expected in (
            (
                {"nickname": "Player"},
                {"nickname": "Player", "avatarUrl": None, "steamId": None},
            ),
            (
                {"nickname": "Player", "avatarUrl": 1, "steamId": ""},
                {"nickname": "Player", "avatarUrl": None, "steamId": None},
            ),
            ({"avatarUrl": "https://avatar.example"}, None),
            ({"nickname": None}, None),
        ):
            with self.subTest(body=body):
                with patch.object(
                    activity_api,
                    "request_json_status",
                    return_value=self._response(200, body),
                ):
                    self.assertEqual(await self.client.get_user(), expected)

    async def test_get_user_401_cancels_active_task_and_ends_session(self) -> None:
        """Clear a rejected token, cancel polling, and publish signed-out last."""
        token = "pat_" + "1" * 64
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: token,
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2998-10-27T00:00:00+00:00",
                "activityRetroAchievements": {
                    "userName": "DeckPlayer",
                    "apiKey": "ra-secret",
                },
            }
        )

        async def wait_forever() -> None:
            """Represent an active authorization worker."""
            await asyncio.Event().wait()

        task = asyncio.create_task(wait_forever())
        self.client._task = task
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=self._response(401, {"error": "unauthorized"}),
        ) as request:
            self.assertIsNone(await self.client.get_user())

        self.assertIsNone(self.client._task)
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertIsNone(self.settings().get(token_store.ACCESS_TOKEN_SETTING, str))
        self.assertIsNone(
            self.settings().get(token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING, str)
        )
        self.assertIsNone(self.settings().get("activityRetroAchievements", dict))
        expected_state = {
            "accessTokensUrl": "",
            "codeExpiresAt": 0,
            "retroAchievementsLinked": False,
            "status": "signedOut",
            "tokenExpiresAt": "",
            "userCode": "",
            "verificationUri": "",
            "verificationUriComplete": "",
        }
        self.assertEqual(
            {
                key: value
                for key, value in self.client.get_state().items()
                if key != "message"
            },
            expected_state,
        )
        self.assertEqual(
            {
                key: value
                for key, value in decky.emit.call_args_list[-1].args[1].items()
                if key != "message"
            },
            expected_state,
        )
        request.assert_called_once_with(
            "https://activity.o3h3.com/api/v1/me",
            method="GET",
            body=None,
            bearer_token=token,
        )

    async def test_stale_user_response_cannot_clear_newer_token(self) -> None:
        """Protect a replacement session without an authorization-generation change."""
        token_a = "pat_" + "a" * 64
        token_b = "pat_" + "b" * 64
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: token_a,
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2998-10-27T00:00:00+00:00",
                "activityRetroAchievements": {
                    "userName": "AccountA",
                    "apiKey": "account-a-secret",
                },
            }
        )

        def stale_response(_: str, **__: object) -> HttpJsonResponse:
            self.settings().update(
                {
                    token_store.ACCESS_TOKEN_SETTING: token_b,
                    token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2998-11-27T00:00:00+00:00",
                    "activityRetroAchievements": {
                        "userName": "AccountB",
                        "apiKey": "account-b-secret",
                    },
                }
            )
            return self._response(401, {"error": "unauthorized"})

        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=stale_response,
        ):
            self.assertIsNone(await self.client.get_user())

        self.assertEqual(
            self.settings().get(token_store.ACCESS_TOKEN_SETTING, str),
            token_b,
        )
        self.assertEqual(
            self.settings().get("activityRetroAchievements", dict),
            {"userName": "AccountB", "apiKey": "account-b-secret"},
        )
        credentials = self.client.retro_achievements_credentials()
        self.assertEqual(credentials.username, "AccountB")
        self.assertEqual(credentials.api_key, "account-b-secret")
        decky.emit.assert_not_called()

    async def test_stale_user_success_cannot_return_old_account(self) -> None:
        """Ignore the old account after replacing its token without changing generation."""
        token_a = "pat_" + "a" * 64
        token_b = "pat_" + "b" * 64
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: token_a,
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2998-10-27T00:00:00+00:00",
            }
        )

        def stale_response(_: str, **__: object) -> HttpJsonResponse:
            self.settings().update(
                {
                    token_store.ACCESS_TOKEN_SETTING: token_b,
                    token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2998-11-27T00:00:00+00:00",
                }
            )
            return self._response(
                200,
                {"nickname": "Account A", "avatarUrl": None},
            )

        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=stale_response,
        ):
            self.assertIsNone(await self.client.get_user())

        self.assertEqual(
            self.settings().get(token_store.ACCESS_TOKEN_SETTING, str),
            token_b,
        )

    def test_api_url_respects_configured_api_base_path(self) -> None:
        """Avoid duplicating /api when the configured base already contains it."""
        self.assertEqual(
            activity_api.ActivityApiClient("http://host/api/").url(
                device_endpoint.DEVICE_START_PATH
            ),
            "http://host/api/v1/auth/device",
        )

    async def test_end_session_ignores_a_token_that_is_no_longer_saved(self) -> None:
        """Leave a replacement session untouched after an older token is rejected."""
        token_a = "pat_" + "a" * 64
        token_b = "pat_" + "b" * 64
        self.settings().update({token_store.ACCESS_TOKEN_SETTING: token_b})

        await self.client.end_session(token_a)

        self.assertEqual(
            self.settings().get(token_store.ACCESS_TOKEN_SETTING, str),
            token_b,
        )
        decky.emit.assert_not_called()

    async def test_end_session_clears_the_saved_token_and_publishes_signed_out(
        self,
    ) -> None:
        """Clear a rejected current token and publish the terminal signed-out state."""
        token = "pat_" + "a" * 64
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: token,
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2998-10-27T00:00:00+00:00",
            }
        )

        await self.client.end_session(token)

        self.assertIsNone(self.settings().get(token_store.ACCESS_TOKEN_SETTING, str))
        self.assertIsNone(
            self.settings().get(token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING, str)
        )
        self.assertEqual(decky.emit.call_args_list[-1].args[1]["status"], "signedOut")
