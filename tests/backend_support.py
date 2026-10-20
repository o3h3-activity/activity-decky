"""Isolated Decky environment shared by backend capability tests."""

import asyncio
import importlib.util
import logging
import sys
import tempfile
import time
import types
import unittest
from collections.abc import Awaitable, Callable
from pathlib import Path
from unittest.mock import AsyncMock

ROOT = Path(__file__).resolve().parents[1]
decky = types.ModuleType("decky")
decky.DECKY_PLUGIN_VERSION = "test"
decky.DECKY_PLUGIN_DIR = str(ROOT)
decky.logger = logging.getLogger("activity-tests")
decky.logger.addHandler(logging.NullHandler())
decky.logger.propagate = False
decky.emit = AsyncMock()
sys.modules["decky"] = decky
sys.path.insert(0, str(ROOT / "py_modules"))

from activity_backend.infrastructure.activity_transport import (  # noqa: E402
    ActivityApiClient,
)
from activity_backend.infrastructure.settings import SettingsStore  # noqa: E402
from activity_backend.modules.authorization.adapters.decky_emitter import (  # noqa: E402
    DeckyAuthorizationEmitter,
)
from activity_backend.modules.authorization.adapters.device_endpoint import (  # noqa: E402
    ActivityDeviceAuthorizationEndpoint,
)
from activity_backend.modules.authorization.adapters.token_store import (  # noqa: E402
    SettingsTokenStore,
)
from activity_backend.modules.authorization.api import (  # noqa: E402
    DeviceAuthorizationClient,
)

main_spec = importlib.util.spec_from_file_location("activity_main", ROOT / "main.py")
if main_spec is None or main_spec.loader is None:
    raise RuntimeError("Could not load main.py for backend tests")
activity_main = importlib.util.module_from_spec(main_spec)
sys.modules[main_spec.name] = activity_main
main_spec.loader.exec_module(activity_main)


class BackendTestCase(unittest.TestCase):
    """Provide isolated Decky settings and home paths for backend tests."""

    def setUp(self) -> None:
        self._temporary_directory = tempfile.TemporaryDirectory()
        self.path = Path(self._temporary_directory.name)
        decky.DECKY_USER_HOME = str(self.path)
        decky.DECKY_PLUGIN_SETTINGS_DIR = str(self.path / "settings")

    def tearDown(self) -> None:
        self._temporary_directory.cleanup()

    def settings(self) -> SettingsStore:
        return SettingsStore(Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "activity.json")


def make_authorization(
    settings: SettingsStore,
    *,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    wall_clock: Callable[[], float] = time.time,
) -> DeviceAuthorizationClient:
    """Build the real authorization workflow with optional deterministic time."""
    return DeviceAuthorizationClient(
        SettingsTokenStore(settings),
        ActivityDeviceAuthorizationEndpoint(
            ActivityApiClient("https://activity.o3h3.com/api")
        ),
        decky.logger,
        DeckyAuthorizationEmitter().emit,
        clock=clock,
        sleep=sleep,
        wall_clock=wall_clock,
    )
