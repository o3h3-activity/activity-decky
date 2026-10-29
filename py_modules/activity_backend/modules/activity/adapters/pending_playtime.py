"""Settings-backed durable queue for committed PlayTime intervals."""

from __future__ import annotations

from typing import cast

from activity_backend.shared import Settings

from ..playtime import PendingPlaytime, PlaytimeRequest, valid_pending_playtime
from ..validation import is_uuid
from .settings_mapping import mapping_copy

ACKNOWLEDGED_PLAYTIME_SETTING = "acknowledgedPlaytime"
PENDING_PLAYTIME_SETTING = "pendingPlaytime"
# Acknowledged intervals only absorb duplicate commits and retried RPCs whose
# response was lost, so each Steam account keeps just its most recent uploads.
ACKNOWLEDGED_PLAYTIME_LIMIT = 256

_Key = tuple[int, int, int]


class SettingsPendingPlaytime:
    """Persist Steam-account-scoped committed intervals without credentials."""

    def __init__(self, settings: Settings) -> None:
        self._settings: Settings = settings

    def load(self, steam_id: str) -> list[PendingPlaytime]:
        """Return the valid unresolved intervals owned by one Steam account."""
        return self._load(PENDING_PLAYTIME_SETTING, steam_id)

    def enqueue(
        self, steam_id: str, app_id: int, started_at: int, ended_at: int
    ) -> bool:
        """Durably add one exact interval unless it is already queued or acknowledged.

        Returns whether the interval was newly persisted.
        """
        key = (app_id, started_at, ended_at)
        pending = self._load(PENDING_PLAYTIME_SETTING, steam_id)
        if _find(pending, key) is not None or self._is_acknowledged(steam_id, key):
            return False
        pending.append({"appId": app_id, "startedAt": started_at, "endedAt": ended_at})
        self._store(steam_id, {PENDING_PLAYTIME_SETTING: pending})
        return True

    def bind(
        self, steam_id: str, app_id: int, request: PlaytimeRequest
    ) -> PlaytimeRequest | None:
        """Durably resolve an interval, retaining any identity bound by an earlier retry.

        Returns None when the interval was already uploaded.
        """
        key = (app_id, request["started_at"], request["ended_at"])
        pending = self._load(PENDING_PLAYTIME_SETTING, steam_id)
        entry: PendingPlaytime | None = _find(pending, key)
        if entry is None:
            if self._is_acknowledged(steam_id, key):
                return None
            entry = {"appId": app_id, "startedAt": key[1], "endedAt": key[2]}
            pending.append(entry)
        elif "gameId" in entry:
            return _request(entry)
        entry.update(
            {
                "gameId": request["game_id"],
                "releaseId": request["release_id"],
                "releaseRevisionId": request["release_revision_id"],
            }
        )
        self._store(steam_id, {PENDING_PLAYTIME_SETTING: pending})
        return request

    def acknowledge(
        self, steam_id: str, app_id: int, started_at: int, ended_at: int
    ) -> None:
        """Move one fully uploaded interval into the bounded acknowledged history."""
        key = (app_id, started_at, ended_at)
        pending = self._load(PENDING_PLAYTIME_SETTING, steam_id)
        uploaded = _find(pending, key)
        if uploaded is None:
            return
        acknowledged = _without(
            self._load(ACKNOWLEDGED_PLAYTIME_SETTING, steam_id), key
        )
        acknowledged.append(uploaded)
        self._store(
            steam_id,
            {
                PENDING_PLAYTIME_SETTING: _without(pending, key),
                ACKNOWLEDGED_PLAYTIME_SETTING: acknowledged[
                    -ACKNOWLEDGED_PLAYTIME_LIMIT:
                ],
            },
        )

    def discard(
        self, steam_id: str, app_id: int, started_at: int, ended_at: int
    ) -> None:
        """Drop one interval Activity permanently refused."""
        key = (app_id, started_at, ended_at)
        pending = self._load(PENDING_PLAYTIME_SETTING, steam_id)
        if _find(pending, key) is not None:
            self._store(steam_id, {PENDING_PLAYTIME_SETTING: _without(pending, key)})

    def _is_acknowledged(self, steam_id: str, key: _Key) -> bool:
        acknowledged = self._load(ACKNOWLEDGED_PLAYTIME_SETTING, steam_id)
        return _find(acknowledged, key) is not None

    def _load(self, setting: str, steam_id: str) -> list[PendingPlaytime]:
        root = mapping_copy(self._settings.get(setting, object))
        return _decode_entries(root.get(steam_id))

    def _store(
        self, steam_id: str, entries_by_setting: dict[str, list[PendingPlaytime]]
    ) -> None:
        """Atomically replace this account's lists, dropping the ones left empty."""
        updates: dict[str, object] = {}
        for setting, entries in entries_by_setting.items():
            root = mapping_copy(self._settings.get(setting, object))
            if entries:
                root[steam_id] = entries
            else:
                _ = root.pop(steam_id, None)
            updates[setting] = root
        self._settings.update(updates)


def _key(entry: PendingPlaytime) -> _Key:
    return (entry["appId"], entry["startedAt"], entry["endedAt"])


def _find(entries: list[PendingPlaytime], key: _Key) -> PendingPlaytime | None:
    return next((entry for entry in entries if _key(entry) == key), None)


def _without(entries: list[PendingPlaytime], key: _Key) -> list[PendingPlaytime]:
    return [entry for entry in entries if _key(entry) != key]


def _request(entry: PendingPlaytime) -> PlaytimeRequest:
    """Read a bound entry, whose identity `_decode_entries` validated together."""
    return {
        "game_id": entry.get("gameId", ""),
        "release_id": entry.get("releaseId", ""),
        "release_revision_id": entry.get("releaseRevisionId", ""),
        "started_at": entry["startedAt"],
        "ended_at": entry["endedAt"],
    }


def _decode_entries(value: object) -> list[PendingPlaytime]:
    """Decode unique valid intervals, each with a complete identity or none."""
    if not isinstance(value, list):
        return []
    entries: list[PendingPlaytime] = []
    seen: set[_Key] = set()
    for raw_entry in cast(list[object], value):
        if not isinstance(raw_entry, dict):
            continue
        values = cast(dict[object, object], raw_entry)
        entry = valid_pending_playtime(
            values.get("appId"), values.get("startedAt"), values.get("endedAt")
        )
        if entry is None or _key(entry) in seen:
            continue
        game_id = values.get("gameId")
        release_id = values.get("releaseId")
        release_revision_id = values.get("releaseRevisionId")
        if is_uuid(game_id) and is_uuid(release_id) and is_uuid(release_revision_id):
            entry.update(
                {
                    "gameId": game_id,
                    "releaseId": release_id,
                    "releaseRevisionId": release_revision_id,
                }
            )
        elif not (
            game_id is None and release_id is None and release_revision_id is None
        ):
            continue
        entries.append(entry)
        seen.add(_key(entry))
    return entries


__all__ = [
    "ACKNOWLEDGED_PLAYTIME_LIMIT",
    "ACKNOWLEDGED_PLAYTIME_SETTING",
    "PENDING_PLAYTIME_SETTING",
    "SettingsPendingPlaytime",
]
