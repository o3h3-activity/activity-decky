"""Settings-backed storage for per-account release-version playtime."""

from __future__ import annotations

from typing import cast

from activity_backend.shared import Settings

from ..playtime import PlaytimeLedger

PLAYTIME_TOTALS_SETTING = "playtimeTotals"


class SettingsPlaytimeTotals:
    """Persist exact intervals and their accumulated UTC-day milliseconds."""

    def __init__(self, settings: Settings) -> None:
        self._settings: Settings = settings

    def load(
        self,
        account_id: str,
        game_id: str,
        release_id: str,
        release_revision_id: str,
    ) -> PlaytimeLedger:
        """Decode the stored ledger for one account and release version."""
        raw = self._ledger_value(
            self._settings.get(PLAYTIME_TOTALS_SETTING, object),
            account_id,
            game_id,
            release_id,
            release_revision_id,
        )
        if not isinstance(raw, dict):
            return PlaytimeLedger()
        values = cast(dict[object, object], raw)
        return PlaytimeLedger(
            days=self._decode_days(values.get("days")),
            intervals=self._decode_intervals(values.get("intervals")),
        )

    def save(
        self,
        account_id: str,
        game_id: str,
        release_id: str,
        release_revision_id: str,
        ledger: PlaytimeLedger,
    ) -> None:
        """Atomically replace this ledger while retaining other account data."""
        raw = self._settings.get(PLAYTIME_TOTALS_SETTING, object)
        root = self._mapping_copy(raw)
        account = self._mapping_copy(root.get(account_id))
        game = self._mapping_copy(account.get(game_id))
        release = self._mapping_copy(game.get(release_id))
        release[release_revision_id] = {
            "days": dict(sorted(ledger.days.items())),
            "intervals": [list(interval) for interval in sorted(ledger.intervals)],
        }
        game[release_id] = release
        account[game_id] = game
        root[account_id] = account
        self._settings.update({PLAYTIME_TOTALS_SETTING: root})

    @staticmethod
    def _ledger_value(
        root: object,
        account_id: str,
        game_id: str,
        release_id: str,
        release_revision_id: str,
    ) -> object:
        current = root
        for key in (account_id, game_id, release_id, release_revision_id):
            if not isinstance(current, dict):
                return None
            current = cast(dict[object, object], current).get(key)
        return current

    @staticmethod
    def _mapping_copy(value: object) -> dict[str, object]:
        if not isinstance(value, dict):
            return {}
        return {
            key: item
            for key, item in cast(dict[object, object], value).items()
            if isinstance(key, str)
        }

    @staticmethod
    def _decode_days(value: object) -> dict[str, int]:
        if not isinstance(value, dict):
            return {}
        return {
            day: milliseconds
            for day, milliseconds in cast(dict[object, object], value).items()
            if isinstance(day, str)
            and isinstance(milliseconds, int)
            and not isinstance(milliseconds, bool)
            and milliseconds >= 0
        }

    @staticmethod
    def _decode_intervals(value: object) -> set[tuple[int, int]]:
        if not isinstance(value, list):
            return set()
        intervals: set[tuple[int, int]] = set()
        for value_interval in cast(list[object], value):
            if not isinstance(value_interval, list):
                continue
            interval = cast(list[object], value_interval)
            if (
                len(interval) == 2
                and isinstance(interval[0], int)
                and not isinstance(interval[0], bool)
                and isinstance(interval[1], int)
                and not isinstance(interval[1], bool)
                and interval[1] >= interval[0]
            ):
                intervals.add((interval[0], interval[1]))
        return intervals


__all__ = ["PLAYTIME_TOTALS_SETTING", "SettingsPlaytimeTotals"]
