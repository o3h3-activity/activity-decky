"""Identity discovery workflows."""

import asyncio
import logging
from _thread import LockType
from collections.abc import Sequence
from concurrent.futures import Future
from pathlib import Path
from threading import Lock
from typing import Protocol, cast

from .models import (
    FileMetadataKey,
    GameIdentity,
    IdentityLookup,
    identity_cache_key,
    supported_rom_path,
    validated_identity,
)


class GameAnatomy(Protocol):
    """Native game-anatomy operations consumed by identity workflows."""

    def generate_hash(self, path: str) -> object:
        """Return untrusted identity information for a disc image."""
        ...


class NativeOperations(Protocol):
    """Loads the game-anatomy extension on demand."""

    def load(self) -> GameAnatomy:
        """Load the extension."""
        ...


class GameIdentityBatch:
    """Identify supported disc images and cache successful file identities."""

    def __init__(
        self, home: Path, native: NativeOperations, logger: logging.Logger
    ) -> None:
        """Bind the user home, native loader, and operational logger."""
        self._home: Path = home
        self._native: NativeOperations = native
        self._logger: logging.Logger = logger
        self._identities: dict[FileMetadataKey, GameIdentity] = {}
        self._hashing: dict[FileMetadataKey, Future[IdentityLookup]] = {}
        self._identity_lock: LockType = Lock()

    def supported_rom_path(self, value: object) -> Path | None:
        """Return a supported absolute ROM path using this plugin's user home."""
        return supported_rom_path(value, self._home)

    def identify_path(self, path: Path) -> GameIdentity | None:
        """Identify one ROM, returning no identity for unsupported native outcomes."""
        return self.identify_path_outcome(path).identity

    def identify_path_outcome(
        self, path: Path, *, metadata_key: FileMetadataKey | None = None
    ) -> IdentityLookup:
        """Identify one ROM, optionally reusing already-read file metadata."""
        key = metadata_key if metadata_key is not None else self._metadata_key(path)
        if key is None:
            return IdentityLookup(None)

        cached = self._cached_identity(key)
        if cached is not None:
            return IdentityLookup(cached)

        try:
            game_anatomy = self._native.load()
        except (ImportError, OSError, ValueError):
            self._logger.exception("game-anatomy failed to load")
            return IdentityLookup(None)
        return self._identify_uncached(game_anatomy, key, path)

    async def handshake(self) -> bool:
        """Load game-anatomy and verify that its hashing entrypoint is available."""
        try:
            game_anatomy = await asyncio.to_thread(self._native.load)
            connected = callable(game_anatomy.generate_hash)
        except (AttributeError, ImportError, OSError):
            self._logger.exception("game-anatomy startup check failed")
            return False

        if connected:
            self._logger.info("game-anatomy Python extension is connected")
        else:
            self._logger.error("game-anatomy hashing entrypoint is unavailable")
        return connected

    def compute(self, games: Sequence[object]) -> list[dict[str, object]]:
        """Identify valid game paths, omitting unsupported or unidentifiable entries."""
        validated: list[tuple[int, FileMetadataKey]] = []
        pending: dict[FileMetadataKey, Path] = {}
        identities: dict[FileMetadataKey, GameIdentity] = {}
        for game in games:
            if not isinstance(game, dict):
                continue
            fields = cast(dict[object, object], game)
            app_id = fields.get("appId")
            path = self.supported_rom_path(fields.get("path"))
            if type(app_id) is not int or path is None:
                continue

            key = self._metadata_key(path)
            if key is None:
                continue
            validated.append((app_id, key))
            cached = self._cached_identity(key)
            if cached is not None:
                identities[key] = cached
            else:
                _ = pending.setdefault(key, path)

        if pending:
            self._identify_pending(pending, identities)
        return [
            {"appId": app_id, **identities[key]}
            for app_id, key in validated
            if key in identities
        ]

    def _metadata_key(self, path: Path) -> FileMetadataKey | None:
        """Return a metadata key, logging a path that cannot be statted."""
        try:
            return identity_cache_key(path, path.stat())
        except OSError as error:
            self._logger.info("Cannot stat disc image %s: %s", path, error)
            return None

    def _cached_identity(self, key: FileMetadataKey) -> GameIdentity | None:
        """Return the successful identity for unchanged file metadata."""
        with self._identity_lock:
            return self._identities.get(key)

    def _identify_pending(
        self,
        pending: dict[FileMetadataKey, Path],
        identities: dict[FileMetadataKey, GameIdentity],
    ) -> None:
        """Load game-anatomy once and identify every uncached disc image."""
        try:
            game_anatomy = self._native.load()
        except (ImportError, OSError, ValueError):
            self._logger.exception("game-anatomy failed to load")
            return

        for key, path in pending.items():
            result = self._identify_uncached(game_anatomy, key, path)
            if result.identity is not None:
                identities[key] = result.identity

    def _identify_uncached(
        self, game_anatomy: GameAnatomy, key: FileMetadataKey, path: Path
    ) -> IdentityLookup:
        """Identify one uncached disc image, joining a hash of it already running.

        The frontend abandons a slow batch at its deadline but cannot cancel it, so a retry
        must wait for the running hash rather than read the same image again.
        """
        with self._identity_lock:
            cached = self._identities.get(key)
            if cached is not None:
                return IdentityLookup(cached)
            hashing = self._hashing.get(key)
            owner = hashing is None
            if hashing is None:
                hashing = Future[IdentityLookup]()
                self._hashing[key] = hashing

        if not owner:
            return hashing.result()

        try:
            lookup = self._hash(game_anatomy, key, path)
        except BaseException as error:
            hashing.set_exception(error)
            raise
        else:
            hashing.set_result(lookup)
            return lookup
        finally:
            with self._identity_lock:
                del self._hashing[key]

    def _hash(
        self, game_anatomy: GameAnatomy, key: FileMetadataKey, path: Path
    ) -> IdentityLookup:
        """Identify, validate, and cache one disc image."""
        try:
            info = game_anatomy.generate_hash(str(path))
        except RuntimeError as error:
            self._logger.info("game-anatomy cannot identify %s: %s", path, error)
            return IdentityLookup(None, is_unrecognized=True)
        except (OSError, ValueError) as error:
            self._logger.info("game-anatomy cannot identify %s: %s", path, error)
            return IdentityLookup(None)

        identity = validated_identity(info)
        if identity is None:
            self._logger.error("game-anatomy returned invalid identity for %s", path)
            return IdentityLookup(None)
        with self._identity_lock:
            self._identities[key] = identity
        return IdentityLookup(identity)
