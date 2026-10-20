"""Behavioral coverage for catalog recognition and durable cache policy."""

import asyncio
import unittest
from unittest.mock import patch

from backend_support import BackendTestCase, decky, make_authorization

from activity_backend.infrastructure import activity_transport as activity_api
from activity_backend.modules.authorization.adapters import token_store
from activity_backend.modules.catalog import api as game_recognition
from activity_backend.modules.catalog.adapters.activity_api import (
    ActivityCatalogEndpoint,
    SettingsRecognitionCache,
)
from activity_backend.modules.catalog.recognition import CatalogAnswer
from activity_backend.shared import HttpJsonResponse


class GameRecognitionTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Verify recognition results, cache expiry, and recoverable failures."""

    def setUp(self) -> None:
        """Build the real recognition workflow with deterministic time."""
        super().setUp()
        self.now = 1_000.0
        self.token = "saved-token"
        self.settings().update(
            {
                token_store.ACCESS_TOKEN_SETTING: self.token,
                token_store.ACCESS_TOKEN_EXPIRES_AT_SETTING: "2999-10-27T00:00:00+00:00",
            }
        )
        self.session = make_authorization(self.settings())
        self.client = game_recognition.GameRecognitionClient(
            SettingsRecognitionCache(self.settings()),
            ActivityCatalogEndpoint(
                activity_api.ActivityApiClient("https://activity.o3h3.com/api")
            ),
            self.session,
            decky.logger,
            wall_clock=lambda: self.now,
        )
        self.identity = {
            "platform": "ps1",
            "game_identity_md5": "a" * 32,
            "rcheevos_id": 12,
            "serial": "SLUS-00402",
        }
        self.catalog = {
            "gameId": "11111111-1234-4abc-8def-0123456789ab",
            "releaseId": "0f1e2d3c-1234-4abc-8def-0123456789ab",
            "releaseRevisionId": "a0b1c2d3-1234-4abc-8def-0123456789ab",
        }

    def answer(self) -> dict[str, object]:
        """Return the RPC answer associated with this test's native hash."""
        return {"gameIdentityMd5": "a" * 32, **self.catalog}

    async def test_positive_cache_refreshes_ids_at_exactly_four_hours(self) -> None:
        """Cache hits do not extend TTL, which also survives a client restart."""
        updated_catalog = {
            "gameId": "22222222-1234-4abc-8def-0123456789ab",
            "releaseId": "33333333-1234-4abc-8def-0123456789ab",
            "releaseRevisionId": "44444444-1234-4abc-8def-0123456789ab",
        }
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                HttpJsonResponse(200, self.catalog, 0),
                HttpJsonResponse(200, updated_catalog, 0),
            ],
        ) as request:
            first = await self.client.recognize([self.identity])
            self.now += 14_399
            cached = await self.client.recognize([self.identity])
            restarted = game_recognition.GameRecognitionClient(
                SettingsRecognitionCache(self.settings()),
                ActivityCatalogEndpoint(
                    activity_api.ActivityApiClient("https://activity.o3h3.com/api")
                ),
                self.session,
                decky.logger,
                wall_clock=lambda: self.now,
            )
            self.now += 1
            renewed = await restarted.recognize([self.identity])
            self.now += 14_399
            cached_renewal = await restarted.recognize([self.identity])

        self.assertEqual(first, [self.answer()])
        self.assertEqual(cached, first)
        self.assertEqual(renewed, [{"gameIdentityMd5": "a" * 32, **updated_catalog}])
        self.assertEqual(cached_renewal, renewed)
        self.assertEqual(request.call_count, 2)

    async def test_recognition_sends_lowercase_hash_catalog_platform_and_serial(
        self,
    ) -> None:
        """Native identities map to the declared catalog request contract."""
        for platform, slug in (
            ("ps1", "playstation"),
            ("ps2", "playstation-2"),
            ("psp", "playstation-portable"),
        ):
            with self.subTest(platform=platform):
                self.settings().update({"gameRecognitions": {}})
                with patch.object(
                    activity_api,
                    "request_json_status",
                    return_value=HttpJsonResponse(200, self.catalog, 0),
                ) as request:
                    result = await self.client.recognize(
                        [
                            {
                                **self.identity,
                                "platform": platform,
                                "game_identity_md5": "A" * 32,
                            }
                        ]
                    )

                self.assertEqual(
                    result, [{**self.catalog, "gameIdentityMd5": "A" * 32}]
                )
                request.assert_called_once_with(
                    "https://activity.o3h3.com/api/v1/game-recognition",
                    method="POST",
                    body={"hash": "a" * 32, "platform": slug, "serial": "SLUS-00402"},
                    bearer_token=self.token,
                )

    async def test_recognition_reads_seeded_complete_cache_entry(self) -> None:
        """Fresh persisted answers can identify media without a usable serial."""
        self.settings().update(
            {"gameRecognitions": {"a" * 32: {**self.catalog, "checkedAt": self.now}}}
        )
        with patch.object(activity_api, "request_json_status") as request:
            result = await self.client.recognize([{**self.identity, "serial": None}])

        self.assertEqual(result, [self.answer()])
        request.assert_not_called()

    async def test_positive_cache_without_valid_timestamp_is_re_resolved(self) -> None:
        """Legacy or corrupt timestamps must not retain stale catalog UUIDs."""
        for timestamp in (None, True, "1000", 10**400, float("nan"), float("inf")):
            with self.subTest(timestamp=timestamp):
                stale = {**self.catalog, "gameId": "obsolete-game-id"}
                if timestamp is not None:
                    stale["checkedAt"] = timestamp
                self.settings().update({"gameRecognitions": {"a" * 32: stale}})
                with patch.object(
                    activity_api,
                    "request_json_status",
                    return_value=HttpJsonResponse(200, self.catalog, 0),
                ):
                    result = await self.client.recognize([self.identity])

                self.assertEqual(result, [self.answer()])

    async def test_recognition_re_resolves_cached_positive_without_game_id(
        self,
    ) -> None:
        """Legacy answers cannot supply the game-scoped comment route."""
        self.settings().update(
            {
                "gameRecognitions": {
                    "a" * 32: {
                        "releaseId": self.catalog["releaseId"],
                        "releaseRevisionId": self.catalog["releaseRevisionId"],
                    }
                }
            }
        )
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=HttpJsonResponse(200, self.catalog, 0),
        ):
            result = await self.client.recognize([self.identity])

        self.assertEqual(result, [self.answer()])

    async def test_recognition_ignores_malformed_persisted_cache_entry(self) -> None:
        """Bad persisted identifiers and timestamps must not hide a real answer."""
        self.settings().update(
            {
                "gameRecognitions": {
                    "a" * 32: {
                        "releaseId": ["not-an-id"],
                        "releaseRevisionId": 2,
                        "checkedAt": 10**400,
                    }
                }
            }
        )
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=HttpJsonResponse(200, self.catalog, 0),
        ):
            result = await self.client.recognize([self.identity])

        self.assertEqual(result, [self.answer()])

    async def test_recognition_caches_404_until_exactly_four_hours(self) -> None:
        """Unresolved media is negative-cached, then can acquire a catalog identity."""
        with patch.object(
            activity_api,
            "request_json_status",
            side_effect=[
                HttpJsonResponse(404, {}, 0),
                HttpJsonResponse(200, self.catalog, 0),
            ],
        ) as request:
            first = await self.client.recognize([self.identity])
            self.now += 14_399
            cached = await self.client.recognize([self.identity])
            self.now += 1
            renewed = await self.client.recognize([self.identity])

        self.assertEqual(
            first,
            [
                {
                    "gameIdentityMd5": "a" * 32,
                    "gameId": None,
                    "releaseId": None,
                    "releaseRevisionId": None,
                }
            ],
        )
        self.assertEqual(cached, first)
        self.assertEqual(renewed, [self.answer()])
        self.assertEqual(request.call_count, 2)

    async def test_legacy_incomplete_cache_is_rechecked_after_ttl(self) -> None:
        """A previously unpublished release becomes usable after cache expiry."""
        self.settings().update(
            {
                "gameRecognitions": {
                    "a" * 32: {**self.catalog, "releaseId": None, "checkedAt": self.now}
                }
            }
        )
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=HttpJsonResponse(200, self.catalog, 0),
        ) as request:
            cached = await self.client.recognize([self.identity])
            self.now += 14_400
            renewed = await self.client.recognize([self.identity])

        self.assertEqual(cached, [{**self.answer(), "releaseId": None}])
        self.assertEqual(renewed, [self.answer()])
        request.assert_called_once()

    async def test_malformed_success_does_not_poison_the_cache(self) -> None:
        """Missing/invalid required IDs are failures, not definitive unknown games."""
        for payload in (
            None,
            [],
            {},
            {"catalog": self.catalog},
            {**self.catalog, "gameId": None},
            {**self.catalog, "releaseId": ""},
            {**self.catalog, "releaseRevisionId": 7},
        ):
            with self.subTest(payload=payload):
                self.settings().update({"gameRecognitions": {}})
                with patch.object(
                    activity_api,
                    "request_json_status",
                    side_effect=[
                        HttpJsonResponse(200, payload, 0),
                        HttpJsonResponse(200, self.catalog, 0),
                    ],
                ):
                    first = await self.client.recognize([self.identity])
                    recovered = await self.client.recognize([self.identity])
                self.assertEqual(first, [])
                self.assertEqual(recovered, [self.answer()])

    async def test_request_and_server_failures_are_not_cached_as_unknown(self) -> None:
        """Invalid requests and outages can be corrected without waiting for TTL."""
        for status in (403, 409, 413, 415, 422, 500):
            with self.subTest(status=status):
                self.settings().update({"gameRecognitions": {}})
                with patch.object(
                    activity_api,
                    "request_json_status",
                    side_effect=[
                        HttpJsonResponse(status, {}, 0),
                        HttpJsonResponse(200, self.catalog, 0),
                    ],
                ):
                    first = await self.client.recognize([self.identity])
                    recovered = await self.client.recognize([self.identity])
                self.assertEqual(first, [])
                self.assertEqual(recovered, [self.answer()])

    async def test_missing_serial_is_omitted_without_caching_an_unknown(self) -> None:
        """Serial-less media sends nothing and leaves no negative cache entry."""
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=HttpJsonResponse(200, self.catalog, 0),
        ) as request:
            for serial in (None, "", "   "):
                self.assertEqual(
                    await self.client.recognize([{**self.identity, "serial": serial}]),
                    [],
                )
            request.assert_not_called()
            result = await self.client.recognize([self.identity])

        self.assertEqual(result, [self.answer()])

    async def test_recognition_rate_limit_blocks_until_retry_window_expires(
        self,
    ) -> None:
        """Pause the batch for Retry-After, preserving positives during the pause."""
        second = {**self.identity, "game_identity_md5": "b" * 32}
        third = {**self.identity, "game_identity_md5": "c" * 32}
        for status, retry_after, pause in ((429, 30, 60), (503, 90, 90)):
            with self.subTest(status=status):
                self.settings().update(
                    {
                        "gameRecognitions": {
                            "b" * 32: {**self.catalog, "checkedAt": self.now}
                        }
                    }
                )
                with patch.object(
                    activity_api,
                    "request_json_status",
                    side_effect=[
                        HttpJsonResponse(status, {}, retry_after),
                        HttpJsonResponse(200, self.catalog, 0),
                    ],
                ) as request:
                    first = await self.client.recognize([self.identity, second, third])
                    self.now += pause - 1
                    blocked = await self.client.recognize(
                        [self.identity, second, third]
                    )
                    self.now += 1
                    renewed = await self.client.recognize([self.identity])
                cached_second = [{**self.answer(), "gameIdentityMd5": "b" * 32}]
                self.assertEqual(first, cached_second)
                self.assertEqual(blocked, cached_second)
                self.assertEqual(renewed, [self.answer()])
                self.assertEqual(request.call_count, 2)

    async def test_recognition_401_ends_session_and_stops_the_batch(self) -> None:
        """End the saved session and avoid later requests after token rejection."""
        with patch.object(
            activity_api,
            "request_json_status",
            return_value=HttpJsonResponse(401, {}, 0),
        ) as request:
            result = await self.client.recognize(
                [self.identity, {**self.identity, "game_identity_md5": "b" * 32}]
            )

        self.assertEqual(result, [])
        request.assert_called_once()
        self.assertIsNone(self.session.access_token())

    async def test_recognition_finishing_after_sign_out_does_not_restore_cache(
        self,
    ) -> None:
        """Discard the old session's response and stop its remaining batch."""
        started = asyncio.Event()
        finish = asyncio.Event()

        async def recognize(*_args: object) -> CatalogAnswer:
            started.set()
            await finish.wait()
            return CatalogAnswer(
                self.catalog["gameId"],
                self.catalog["releaseId"],
                self.catalog["releaseRevisionId"],
            )

        with patch.object(
            ActivityCatalogEndpoint, "recognize", side_effect=recognize
        ) as request:
            pending = asyncio.create_task(
                self.client.recognize(
                    [self.identity, {**self.identity, "game_identity_md5": "b" * 32}]
                )
            )
            await started.wait()
            await self.session.sign_out()
            finish.set()
            result = await pending

        self.assertEqual(result, [])
        self.assertIsNone(self.settings().get("gameRecognitions", dict))
        request.assert_called_once()
