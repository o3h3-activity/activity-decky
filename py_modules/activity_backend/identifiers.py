"""Small identity validation primitives shared by backend capabilities."""

from __future__ import annotations

import re
from typing import TypeGuard

_UUID_PATTERN = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


def is_uuid(value: object) -> TypeGuard[str]:
    """Return whether a value is an RFC 4122-shaped UUID string."""
    return isinstance(value, str) and _UUID_PATTERN.fullmatch(value) is not None


__all__ = ["is_uuid"]
