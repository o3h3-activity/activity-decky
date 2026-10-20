"""JSON-backed persistent plugin settings."""

import json
import os
from collections.abc import Mapping
from pathlib import Path
from typing import TypeVar, cast

import decky

SETTINGS_FILE_NAME = "activity.json"
T = TypeVar("T")


class SettingsStore:
    """Settings mapping persisted atomically as a JSON object."""

    def __init__(self, path: Path) -> None:
        """Store the persistent settings file path."""
        self.path: Path = path

    def _read(self) -> dict[str, object]:
        """Load settings, returning an empty mapping when the file is invalid."""
        try:
            settings = cast(object, json.loads(self.path.read_text(encoding="utf-8")))
            if not isinstance(settings, dict):
                raise ValueError("Settings must be a JSON object")
            decky.logger.debug("Loaded activity settings from %s", self.path)
            # JSON object keys are strings; values remain untrusted until get().
            return cast(dict[str, object], settings)
        except (OSError, ValueError):
            decky.logger.debug("No readable activity settings found at %s", self.path)
            return {}

    def _write(self, settings: dict[str, object]) -> None:
        """Atomically persist the complete settings mapping as formatted JSON."""
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.path.with_name(self.path.name + ".tmp")
        fd = os.open(tmp_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        os.fchmod(
            fd, 0o600
        )  # a stale tmp file from a crash keeps its old mode otherwise
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(settings, file, indent=2)
        os.replace(tmp_path, self.path)
        decky.logger.debug("Saved activity settings to %s", self.path)

    def get(self, key: str, kind: type[T]) -> T | None:
        """Return the stored value when it is an instance of `kind`, else None."""
        value = self._read().get(key)
        return value if isinstance(value, kind) else None

    def update(self, changes: Mapping[str, object]) -> None:
        """Merge `changes` into the stored settings; a None value removes the key."""
        settings = self._read()
        for key, value in changes.items():
            if value is None:
                _ = settings.pop(key, None)
            else:
                settings[key] = value
        self._write(settings)
