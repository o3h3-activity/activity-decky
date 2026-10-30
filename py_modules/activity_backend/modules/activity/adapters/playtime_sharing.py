"""Settings-backed PlayTime sharing opt-in."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from activity_backend.shared import Settings

PLAY_TIME_SYNC_ENABLED_SETTING = "isPlayTimeSyncEnabled"


def is_playtime_sharing_enabled(settings: Settings) -> bool:
    """Return the saved opt-in; sharing stays off until the user enables it."""
    return settings.get(PLAY_TIME_SYNC_ENABLED_SETTING, bool) is True


__all__ = ["PLAY_TIME_SYNC_ENABLED_SETTING", "is_playtime_sharing_enabled"]
