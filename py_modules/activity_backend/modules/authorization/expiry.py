"""Pure expiry validation for persisted Activity credentials."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import TypeGuard


def is_valid_expiry(value: object) -> TypeGuard[str]:
    """Return whether a value is a timezone-aware ISO-8601 timestamp."""
    if not isinstance(value, str) or not value:
        return False
    try:
        expiry = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return expiry.tzinfo is not None


def is_expired(
    value: object,
    now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> bool:
    """Return whether an expiry is invalid or no longer in the future."""
    if not isinstance(value, str) or not value:
        return True
    try:
        expiry = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return True
    if expiry.tzinfo is None:
        return True
    return expiry <= now()
