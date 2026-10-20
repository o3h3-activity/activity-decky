"""Ports owned by RetroAchievements workflows."""

from pathlib import Path
from typing import Protocol

from activity_backend.modules.authorization.api import RetroAchievementsCredentials
from activity_backend.modules.identity.api import IdentityLookup


class RetroAchievementsSession(Protocol):
    """Session access required to make a RetroAchievements request."""

    def retro_achievements_credentials(self) -> RetroAchievementsCredentials | None:
        """Return credentials issued for the current valid Activity session."""
        ...


class RetroAchievementsApi(Protocol):
    """Blocking RetroAchievements API operations."""

    def lookup_game_id(self, md5: str) -> int | None:
        """Return the RetroAchievements game id for a game identity hash."""
        ...

    def get_progress(
        self, credentials: RetroAchievementsCredentials, game_id: int
    ) -> object:
        """Return the configured user's progress for one RetroAchievements game."""
        ...


class RomIdentityLookup(Protocol):
    """ROM path validation and identity lookup needed by achievements."""

    def supported_rom_path(self, value: object) -> Path | None:
        """Return a supported absolute ROM path."""
        ...

    def identify_path_outcome(
        self, path: Path, *, metadata_key: tuple[str, int, int] | None = None
    ) -> IdentityLookup:
        """Identify a ROM using file metadata already read by the caller."""
        ...
