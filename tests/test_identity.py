"""Behavioral coverage for identity."""

import asyncio
import threading
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend_support import BackendTestCase, activity_main

from activity_backend.modules.achievements.adapters import http as ra_http
from activity_backend.modules.identity.adapters.native import (
    GameAnatomyNativeOperations,
)


class GameIdentityBatchTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Verify Plugin batches native identity lookup without network dependencies."""

    async def test_batch_returns_only_supported_identified_games(self) -> None:
        """Preserve native identity fields while skipping invalid and failed inputs."""
        iso = self.path / "game.iso"
        pbp = self.path / "game.pbp"
        failure = self.path / "failure.cue"
        for path in (iso, pbp, failure):
            path.write_bytes(b"disc")
        blueprint = MagicMock()
        blueprint.generate_hash.side_effect = [
            {
                "platform": "ps2",
                "identity_md5": "iso-md5",
                "retroachievements_platform_id": 21,
                "serial": None,
            },
            {
                "platform": "psp",
                "identity_md5": "pbp-md5",
                "retroachievements_platform_id": 41,
                "serial": "ULUS-12345",
            },
            RuntimeError("unrecognized"),
        ]
        plugin = activity_main.Plugin()

        with patch.object(
            GameAnatomyNativeOperations, "load", return_value=blueprint
        ) as load:
            result = await plugin.get_game_identities(
                [
                    {"appId": 1, "path": "~/game.iso"},
                    {"appId": 2, "path": str(pbp)},
                    {"appId": 6, "path": str(iso)},
                    {"appId": 3, "path": str(self.path / "game.exe")},
                    {"appId": 4, "path": "relative.iso"},
                    {"appId": 5, "path": str(failure)},
                    {"appId": True, "path": str(iso)},
                ]
            )

        self.assertEqual(
            result,
            [
                {
                    "appId": 1,
                    "platform": "ps2",
                    "game_identity_md5": "iso-md5",
                    "rcheevos_id": 21,
                    "serial": None,
                },
                {
                    "appId": 2,
                    "platform": "psp",
                    "game_identity_md5": "pbp-md5",
                    "rcheevos_id": 41,
                    "serial": "ULUS-12345",
                },
                {
                    "appId": 6,
                    "platform": "ps2",
                    "game_identity_md5": "iso-md5",
                    "rcheevos_id": 21,
                    "serial": None,
                },
            ],
        )
        load.assert_called_once_with()
        self.assertEqual(
            [call.args[0] for call in blueprint.generate_hash.call_args_list],
            [str(iso), str(pbp), str(failure)],
        )

    async def test_batch_cache_skips_native_import_for_unchanged_rom(self) -> None:
        """Reuse a successful plugin identity without loading game-anatomy again."""
        rom = self.path / "game.iso"
        rom.write_bytes(b"disc")
        identity = {
            "platform": "ps1",
            "identity_md5": "md5",
            "retroachievements_platform_id": 12,
            "serial": "SLUS-12345",
        }
        plugin = activity_main.Plugin()

        with patch.object(GameAnatomyNativeOperations, "load") as load:
            load.return_value.generate_hash.return_value = identity
            first_result = await plugin.get_game_identities(
                [{"appId": 1, "path": "~/game.iso"}]
            )
            load.reset_mock()
            second_result = await plugin.get_game_identities(
                [{"appId": 1, "path": "~/game.iso"}]
            )

        self.assertEqual(first_result, second_result)
        load.assert_not_called()

    async def test_batch_identity_is_reused_by_progress_until_rom_changes(self) -> None:
        """Share batch hashes with progress, then re-identify changed ROM contents."""
        rom = self.path / "game.iso"
        rom.write_bytes(b"disc")
        identity = {
            "platform": "ps1",
            "identity_md5": "md5",
            "retroachievements_platform_id": 12,
            "serial": "SLUS-12345",
        }
        plugin = activity_main.Plugin()
        with patch.object(GameAnatomyNativeOperations, "load") as load:
            load.return_value.generate_hash.return_value = identity
            await plugin.get_game_identities([{"appId": 1, "path": "~/game.iso"}])

        def request_json(url: str, **_: object) -> object:
            """Return deterministic game-id and progress responses."""
            if url == ra_http.RA_CONNECT_URL:
                return {"Success": True, "GameID": 42}
            return {"ok": True}

        changed_blueprint = MagicMock()
        changed_blueprint.generate_hash.return_value = identity
        with patch.object(
            plugin.backend.authorization,
            "retro_achievements_credentials",
            return_value=SimpleNamespace(username="user", api_key="key"),
            create=True,
        ):
            with patch.object(
                GameAnatomyNativeOperations,
                "load",
                return_value=changed_blueprint,
            ) as load:
                with patch.object(ra_http, "request_json", side_effect=request_json):
                    self.assertEqual(
                        await plugin.get_retro_achievements("~/game.iso"), {"ok": True}
                    )
                    rom.write_bytes(b"changed")
                    self.assertEqual(
                        await plugin.get_retro_achievements("~/game.iso"), {"ok": True}
                    )

        load.assert_called_once_with()
        changed_blueprint.generate_hash.assert_called_once_with(str(rom))

    async def test_retried_batch_joins_the_running_hash_of_an_uncached_rom(
        self,
    ) -> None:
        """Hash a ROM once when a retry arrives while the abandoned batch still hashes it."""
        rom = self.path / "game.iso"
        rom.write_bytes(b"disc")
        identity = {
            "platform": "ps1",
            "identity_md5": "md5",
            "retroachievements_platform_id": 12,
            "serial": "SLUS-12345",
        }
        hashing = threading.Event()
        release = threading.Event()

        def generate_hash(_path: str) -> object:
            """Hold the first hash until the retry has had time to start its own."""
            hashing.set()
            _ = release.wait(timeout=5)
            return identity

        plugin = activity_main.Plugin()
        request: list[object] = [{"appId": 1, "path": "~/game.iso"}]
        with patch.object(GameAnatomyNativeOperations, "load") as load:
            load.return_value.generate_hash.side_effect = generate_hash
            abandoned = asyncio.create_task(plugin.get_game_identities(request))
            self.assertTrue(await asyncio.to_thread(hashing.wait, 5))
            retried = asyncio.create_task(plugin.get_game_identities(request))
            # Long enough for an unjoined retry to reach the native hash.
            await asyncio.sleep(0.2)
            release.set()
            first, second = await asyncio.gather(abandoned, retried)

        self.assertEqual(first, second)
        load.return_value.generate_hash.assert_called_once_with(str(rom))

    async def test_empty_batch_skips_native_import(self) -> None:
        """Do not load the extension when no input can reach it."""
        plugin = activity_main.Plugin()
        with patch.object(GameAnatomyNativeOperations, "load") as load:
            self.assertEqual(
                await plugin.get_game_identities(
                    [{"appId": 1, "path": None}, {"appId": 2, "path": "~/game.exe"}]
                ),
                [],
            )

        load.assert_not_called()
