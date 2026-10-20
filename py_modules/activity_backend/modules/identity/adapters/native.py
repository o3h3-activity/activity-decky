"""game-anatomy native-extension adapter."""

import importlib
import sys
from pathlib import Path
from typing import cast

from ..service import GameAnatomy


class GameAnatomyNativeOperations:
    """Load the bundled game-anatomy extension from a configured plugin directory."""

    def __init__(self, plugin_directory: Path) -> None:
        """Bind the directory containing the bundled ``bin`` extension directory."""
        self._plugin_directory: Path = plugin_directory

    def load(self) -> GameAnatomy:
        """Import and return the extension's structural API."""
        plugin_bin = str(self._plugin_directory / "bin")
        if plugin_bin not in sys.path:
            sys.path.insert(0, plugin_bin)
        module = importlib.import_module("game_anatomy")
        return cast(GameAnatomy, cast(object, module))
