"""Supported public Activity RPC API."""

from .adapters.playtime_sharing import (
    PLAY_TIME_SYNC_ENABLED_SETTING,
    is_playtime_sharing_enabled,
)
from .playtime import PendingPlaytime
from .results import ApiErrorCode, ApiFailure, ApiResult, ApiSuccess
from .service import ActivityProxy

__all__ = [
    "PLAY_TIME_SYNC_ENABLED_SETTING",
    "ActivityProxy",
    "ApiErrorCode",
    "ApiFailure",
    "ApiResult",
    "ApiSuccess",
    "PendingPlaytime",
    "is_playtime_sharing_enabled",
]
