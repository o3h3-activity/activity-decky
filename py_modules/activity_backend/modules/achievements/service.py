"""RetroAchievements progress workflows."""

import asyncio
import logging
from _thread import LockType
from pathlib import Path
from threading import Lock
from typing import TypeAlias

from .ports import (
    RetroAchievementsApi,
    RetroAchievementsSession,
    RomIdentityLookup,
)

RA_NO_GAME_ID = 0
FileMetadataKey: TypeAlias = tuple[str, int, int]


class RetroAchievementsClient:
    """Look up session-authorized RetroAchievements progress for ROMs."""

    def __init__(
        self,
        session: RetroAchievementsSession,
        api: RetroAchievementsApi,
        identities: RomIdentityLookup,
        logger: logging.Logger,
    ) -> None:
        """Bind session access, external API, shared identity service, and logging."""
        self._session: RetroAchievementsSession = session
        self._api: RetroAchievementsApi = api
        self._identities: RomIdentityLookup = identities
        self._logger: logging.Logger = logger
        self._game_ids: dict[FileMetadataKey, int] = {}
        self._game_ids_lock: LockType = Lock()

    async def get_progress(self, rom_path: object) -> object:
        """Fetch the current session user's RetroAchievements progress for one ROM."""
        credentials = self._session.retro_achievements_credentials()
        if credentials is None:
            self._logger.debug("RetroAchievements credentials unavailable")
            return None

        path = self._identities.supported_rom_path(rom_path)
        if path is None:
            self._logger.error("Invalid RetroAchievements ROM path")
            return None

        game_id = await asyncio.to_thread(self._resolve_game_id, path)
        if game_id is None or game_id == RA_NO_GAME_ID:
            return None
        if credentials != self._session.retro_achievements_credentials():
            self._logger.debug(
                "RetroAchievements credentials changed during ROM lookup"
            )
            return None

        progress = await asyncio.to_thread(self._api.get_progress, credentials, game_id)
        if credentials != self._session.retro_achievements_credentials():
            self._logger.debug(
                "RetroAchievements credentials changed during progress lookup"
            )
            return None
        return progress

    def _resolve_game_id(self, rom: Path) -> int | None:
        """Resolve one ROM's game id, caching only successful and no-game outcomes."""
        key = self._metadata_key(rom)
        if key is None:
            return None

        with self._game_ids_lock:
            cached = self._game_ids.get(key)
        if cached is not None:
            return cached

        self._logger.debug(
            "Checking RetroAchievements game with game-anatomy: input=%s", rom
        )
        identity_result = self._identities.identify_path_outcome(rom, metadata_key=key)
        if identity_result.is_unrecognized:
            self._cache_game_id(key, RA_NO_GAME_ID)
            return RA_NO_GAME_ID
        identity = identity_result.identity
        if identity is None:
            return None

        md5 = identity["game_identity_md5"]
        if not md5:
            return None
        game_id = self._api.lookup_game_id(md5)
        if game_id is None:
            return None
        self._cache_game_id(key, game_id)
        return game_id

    def _metadata_key(self, rom: Path) -> FileMetadataKey | None:
        """Return a metadata key, logging paths that cannot be statted."""
        try:
            file_stat = rom.stat()
        except OSError as error:
            self._logger.error("Cannot stat RetroAchievements ROM %s: %s", rom, error)
            return None
        return (str(rom), file_stat.st_size, file_stat.st_mtime_ns)

    def _cache_game_id(self, key: FileMetadataKey, game_id: int) -> None:
        """Safely cache a game-id result for immutable file metadata."""
        with self._game_ids_lock:
            self._game_ids[key] = game_id
