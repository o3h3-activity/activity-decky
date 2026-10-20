"""Behavioral coverage for achievements."""

import asyncio
import threading
import unittest
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlsplit

from backend_support import BackendTestCase, activity_main, decky

from activity_backend.modules.achievements import api as retro_achievements
from activity_backend.modules.achievements.adapters import http as ra_http
from activity_backend.modules.achievements.adapters.http import RetroAchievementsHttpApi
from activity_backend.modules.authorization.adapters.device_endpoint import (
    ActivityDeviceAuthorizationEndpoint,
)
from activity_backend.modules.authorization.api import RetroAchievementsCredentials
from activity_backend.modules.identity import api as game_identity
from activity_backend.modules.identity.adapters.native import (
    GameAnatomyNativeOperations,
)
from activity_backend.shared import HttpJsonResponse


class Session:
    """Minimal authorization dependency used by achievement tests."""

    def __init__(self, credentials: RetroAchievementsCredentials | None) -> None:
        """Keep the credentials currently available to the session."""
        self._credentials = credentials

    def retro_achievements_credentials(self) -> RetroAchievementsCredentials | None:
        """Return session-issued credentials only while the session is valid."""
        return self._credentials

    def set_credentials(self, credentials: RetroAchievementsCredentials | None) -> None:
        """Replace credentials as an Activity session changes."""
        self._credentials = credentials


class RetroAchievementsTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Verify RetroAchievements lookup and cache behavior."""

    def client(
        self, credentials: RetroAchievementsCredentials | None = None
    ) -> retro_achievements.RetroAchievementsClient:
        """Return a client using credentials supplied by the current session."""
        return self.client_for(Session(credentials))

    def client_for(
        self, session: Session
    ) -> retro_achievements.RetroAchievementsClient:
        """Return a client using one supplied session dependency."""
        identities = game_identity.GameIdentityBatch(
            self.path, GameAnatomyNativeOperations(self.path), decky.logger
        )
        return retro_achievements.RetroAchievementsClient(
            session,
            RetroAchievementsHttpApi(),
            identities,
            decky.logger,
        )

    async def test_progress_uses_session_credentials_and_cached_game_id(self) -> None:
        """Use session-issued credentials while retaining game-id caching."""
        client = self.client(RetroAchievementsCredentials("user", "key"))
        rom = self.path / "game.iso"
        rom.write_bytes(b"rom")
        blueprint = MagicMock()
        blueprint.generate_hash.return_value = {
            "platform": "ps1",
            "identity_md5": "abc",
            "retroachievements_platform_id": 12,
            "serial": None,
        }

        def request_json(url: str, **_: object) -> object:
            """Return distinct deterministic lookup and progress responses."""
            if url == ra_http.RA_CONNECT_URL:
                return {"Success": True, "GameID": 42}
            return {"ok": True}

        with patch.object(GameAnatomyNativeOperations, "load", return_value=blueprint):
            with patch.object(
                ra_http, "request_json", side_effect=request_json
            ) as request:
                result = await client.get_progress("~/game.iso")
                second_result = await client.get_progress("~/game.iso")

        self.assertEqual(result, {"ok": True})
        self.assertEqual(second_result, {"ok": True})
        blueprint.generate_hash.assert_called_once_with(str(rom))
        progress_url = request.call_args_list[1].args[0]
        self.assertEqual(
            parse_qs(urlsplit(progress_url).query),
            {"z": ["user"], "y": ["key"], "u": ["user"], "g": ["42"]},
        )

    async def test_runtime_lookup_failure_is_cached_without_http_request(self) -> None:
        """Cache game-anatomy RuntimeErrors as unresolved games without network calls."""
        client = self.client(RetroAchievementsCredentials("user", "key"))
        rom = self.path / "game.iso"
        rom.write_bytes(b"rom")
        blueprint = MagicMock()
        blueprint.generate_hash.side_effect = RuntimeError("unrecognized")

        with patch.object(GameAnatomyNativeOperations, "load", return_value=blueprint):
            with patch.object(ra_http, "request_json") as request:
                self.assertIsNone(await client.get_progress("~/game.iso"))
                self.assertIsNone(await client.get_progress("~/game.iso"))

        blueprint.generate_hash.assert_called_once_with(str(rom))
        request.assert_not_called()

    async def test_missing_session_credentials_skip_rom_lookup_and_network(
        self,
    ) -> None:
        """Treat an invalid or expired Activity session as unconfigured."""
        client = self.client()
        with patch.object(GameAnatomyNativeOperations, "load") as load:
            with patch.object(ra_http, "request_json") as request:
                self.assertIsNone(await client.get_progress("~/game.iso"))

        load.assert_not_called()
        request.assert_not_called()

    async def test_legacy_manual_credentials_are_not_a_session_fallback(self) -> None:
        """Ignore a replaced account's old local credentials after its session ends."""
        self.settings().update(
            {
                "retroAchievementsUsername": "manual-user",
                "retroAchievementsApiKey": "manual-key",
            }
        )
        client = self.client()
        rom = self.path / "game.iso"
        rom.write_bytes(b"rom")

        with patch.object(GameAnatomyNativeOperations, "load") as load:
            with patch.object(ra_http, "request_json") as request:
                self.assertIsNone(await client.get_progress("~/game.iso"))

        load.assert_not_called()
        request.assert_not_called()

    async def test_approved_device_response_uses_issued_credentials_for_progress(
        self,
    ) -> None:
        """Use credentials from an approved device response in local RA requests."""
        approved = ActivityDeviceAuthorizationEndpoint._decode_poll(
            HttpJsonResponse(
                200,
                {
                    "status": "approved",
                    "accessToken": "pat_" + "0" * 64,
                    "tokenType": "Bearer",
                    "expiresAt": "2998-10-27T00:00:00+00:00",
                    "retroAchievements": {
                        "userName": "issued-user",
                        "apiKey": "issued-key",
                    },
                },
                0,
            )
        )
        self.assertEqual(approved.kind, "approved")
        plugin = activity_main.Plugin()
        await plugin.backend.authorization._save_approved_token(approved.approved_token)
        rom = self.path / "game.iso"
        rom.write_bytes(b"rom")
        blueprint = MagicMock()
        blueprint.generate_hash.return_value = {
            "platform": "ps1",
            "identity_md5": "abc",
            "retroachievements_platform_id": 12,
            "serial": None,
        }

        def request_json(url: str, **_: object) -> object:
            """Return deterministic game-id and progress responses."""
            if url == ra_http.RA_CONNECT_URL:
                return {"Success": True, "GameID": 42}
            return {"ok": True}

        with patch.object(GameAnatomyNativeOperations, "load", return_value=blueprint):
            with patch.object(
                ra_http, "request_json", side_effect=request_json
            ) as request:
                self.assertEqual(
                    await plugin.get_retro_achievements("~/game.iso"), {"ok": True}
                )

        progress_url = request.call_args_list[1].args[0]
        self.assertEqual(
            parse_qs(urlsplit(progress_url).query),
            {
                "z": ["issued-user"],
                "y": ["issued-key"],
                "u": ["issued-user"],
                "g": ["42"],
            },
        )

    async def test_replaced_credentials_skip_inflight_progress_request(self) -> None:
        """Do not issue progress for a session replaced during ROM identification."""
        session = Session(RetroAchievementsCredentials("first-user", "first-key"))
        client = self.client_for(session)
        rom = self.path / "game.iso"
        rom.write_bytes(b"rom")
        identity_started = threading.Event()
        release_identity = threading.Event()
        blueprint = MagicMock()

        def generate_hash(_path: str) -> object:
            """Wait until the Activity session has been replaced."""
            identity_started.set()
            _ = release_identity.wait(timeout=5)
            return {
                "platform": "ps1",
                "identity_md5": "abc",
                "retroachievements_platform_id": 12,
                "serial": None,
            }

        blueprint.generate_hash.side_effect = generate_hash
        with patch.object(GameAnatomyNativeOperations, "load", return_value=blueprint):
            with patch.object(
                ra_http,
                "request_json",
                return_value={"Success": True, "GameID": 42},
            ) as request:
                progress = asyncio.create_task(client.get_progress("~/game.iso"))
                self.assertTrue(await asyncio.to_thread(identity_started.wait, 5))
                session.set_credentials(
                    RetroAchievementsCredentials("second-user", "second-key")
                )
                release_identity.set()
                self.assertIsNone(await progress)

        self.assertEqual(
            [call.args[0] for call in request.call_args_list], [ra_http.RA_CONNECT_URL]
        )

    async def test_cleared_credentials_discard_inflight_progress_response(self) -> None:
        """Discard a progress response after the Activity session is signed out."""
        session = Session(RetroAchievementsCredentials("user", "key"))
        client = self.client_for(session)
        rom = self.path / "game.iso"
        rom.write_bytes(b"rom")
        progress_requested = threading.Event()
        release_progress = threading.Event()
        blueprint = MagicMock()
        blueprint.generate_hash.return_value = {
            "platform": "ps1",
            "identity_md5": "abc",
            "retroachievements_platform_id": 12,
            "serial": None,
        }

        def request_json(url: str, **_: object) -> object:
            """Hold the progress request until the session is signed out."""
            if url == ra_http.RA_CONNECT_URL:
                return {"Success": True, "GameID": 42}
            progress_requested.set()
            _ = release_progress.wait(timeout=5)
            return {"ok": True}

        with patch.object(GameAnatomyNativeOperations, "load", return_value=blueprint):
            with patch.object(ra_http, "request_json", side_effect=request_json):
                progress = asyncio.create_task(client.get_progress("~/game.iso"))
                self.assertTrue(await asyncio.to_thread(progress_requested.wait, 5))
                session.set_credentials(None)
                release_progress.set()
                self.assertIsNone(await progress)
