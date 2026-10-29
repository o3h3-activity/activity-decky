"""Defensive decoding of settings-backed JSON objects."""

from __future__ import annotations

from typing import cast


def mapping_copy(value: object) -> dict[str, object]:
    """Copy a persisted JSON object's string-keyed entries, or start empty."""
    if not isinstance(value, dict):
        return {}
    return {
        key: item
        for key, item in cast(dict[object, object], value).items()
        if isinstance(key, str)
    }


__all__ = ["mapping_copy"]
