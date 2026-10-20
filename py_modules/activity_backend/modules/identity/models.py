"""Identity value types and validation rules."""

from dataclasses import dataclass
from os import stat_result
from pathlib import Path
from typing import TypeAlias, TypedDict, cast

SUPPORTED_ROM_SUFFIXES = frozenset({".bin", ".cue", ".iso", ".mdf", ".pbp"})
SUPPORTED_PLATFORMS = frozenset({"ps1", "ps2", "psp"})

FileMetadataKey: TypeAlias = tuple[str, int, int]


class GameIdentity(TypedDict):
    """Validated identity fields used by the plugin and Activity API."""

    platform: str
    game_identity_md5: str
    rcheevos_id: int
    serial: str | None


@dataclass(frozen=True, slots=True)
class IdentityLookup:
    """The result of identifying one ROM, including a native no-game outcome."""

    identity: GameIdentity | None
    is_unrecognized: bool = False


def supported_rom_path(value: object, home: Path) -> Path | None:
    """Return a supported absolute ROM path, expanding the user-home shorthand."""
    if not isinstance(value, str) or not value:
        return None

    path = home / value[2:] if value.startswith("~/") else Path(value)
    if not path.is_absolute() or path.suffix.lower() not in SUPPORTED_ROM_SUFFIXES:
        return None
    return path


def identity_cache_key(path: Path, file_stat: stat_result) -> FileMetadataKey:
    """Return the identity cache key for already-read ROM metadata."""
    return (str(path), file_stat.st_size, file_stat.st_mtime_ns)


def validated_identity(info: object) -> GameIdentity | None:
    """Convert an untrusted game-anatomy result into a supported plugin identity."""
    if not isinstance(info, dict):
        return None
    fields = cast(dict[object, object], info)
    platform = fields.get("platform")
    game_identity_md5 = fields.get("identity_md5")
    rcheevos_id = fields.get("retroachievements_platform_id")
    serial = fields.get("serial")
    if (
        not isinstance(platform, str)
        or platform not in SUPPORTED_PLATFORMS
        or not isinstance(game_identity_md5, str)
        or type(rcheevos_id) is not int
        or (serial is not None and not isinstance(serial, str))
    ):
        return None
    return {
        "platform": platform,
        "game_identity_md5": game_identity_md5,
        "rcheevos_id": rcheevos_id,
        "serial": serial,
    }
