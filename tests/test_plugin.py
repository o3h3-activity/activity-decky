"""Behavioral coverage for plugin."""

import json
import logging
import unittest
from pathlib import Path

from backend_support import BackendTestCase, activity_main, decky


class PluginTests(BackendTestCase, unittest.IsolatedAsyncioTestCase):
    """Verify Plugin preserves the frontend debug-preference contract."""

    async def test_debug_preference_uses_existing_persisted_key(self) -> None:
        """Return an unset preference and persist the original JSON key when set."""
        plugin = activity_main.Plugin()

        self.assertIsNone(await plugin.get_debug_enabled())
        await plugin.set_debug_enabled(True)

        self.assertTrue(await plugin.get_debug_enabled())
        settings_path = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "activity.json"
        self.assertEqual(
            json.loads(settings_path.read_text(encoding="utf-8")),
            {"isDebugEnabled": True},
        )

    async def test_debug_preference_controls_backend_log_level(self) -> None:
        """Toggle backend debug logs and restore the saved preference."""
        self.addCleanup(decky.logger.setLevel, decky.logger.level)
        plugin = activity_main.Plugin()

        await plugin.set_debug_enabled(True)
        self.assertTrue(decky.logger.isEnabledFor(logging.DEBUG))
        await plugin.set_debug_enabled(False)
        self.assertFalse(decky.logger.isEnabledFor(logging.DEBUG))
        self.assertTrue(decky.logger.isEnabledFor(logging.ERROR))

        await plugin.set_debug_enabled(True)
        decky.logger.setLevel(logging.INFO)
        await activity_main.Plugin()._main()
        self.assertTrue(decky.logger.isEnabledFor(logging.DEBUG))

    async def test_play_time_sync_is_off_until_the_user_opts_in(self) -> None:
        """Default to not sharing, then persist and report the saved choice."""
        plugin = activity_main.Plugin()

        self.assertFalse(await plugin.get_play_time_sync_enabled())
        await plugin.set_play_time_sync_enabled(True)
        self.assertTrue(await activity_main.Plugin().get_play_time_sync_enabled())
        await plugin.set_play_time_sync_enabled(False)
        self.assertFalse(await plugin.get_play_time_sync_enabled())
