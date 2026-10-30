"""Decky backend for Activity settings, API proxying, and native extension checks."""

import asyncio
import logging
from pathlib import Path

import decky
from activity_backend.bootstrap import Backend, build_backend
from activity_backend.modules.activity.api import (
    PLAY_TIME_SYNC_ENABLED_SETTING,
    ApiResult,
    PendingPlaytime,
    is_playtime_sharing_enabled,
)
from activity_backend.modules.authorization.api import (
    ActivityUser,
    DeviceAuthorizationState,
)
from activity_backend.modules.catalog.api import GameRecognition

DEBUG_ENABLED_SETTING = "isDebugEnabled"


def _apply_debug_logging(enabled: bool | None) -> None:
    """Emit DEBUG logs only while enabled; always emit INFO and higher levels."""
    decky.logger.setLevel(logging.DEBUG if enabled else logging.INFO)


class Plugin:
    """Decky RPC surface delegating to capability public APIs."""

    def __init__(self) -> None:
        """Compose the backend from Decky's runtime configuration."""
        self.backend: Backend = build_backend(
            Path(decky.DECKY_PLUGIN_SETTINGS_DIR),
            Path(decky.DECKY_USER_HOME),
            Path(decky.DECKY_PLUGIN_DIR),
            decky.logger,
        )

    async def get_debug_enabled(self) -> bool | None:
        """Return the saved debug preference, or ``None`` when unset."""
        return self.backend.settings.get(DEBUG_ENABLED_SETTING, bool)

    async def set_debug_enabled(self, enabled: bool) -> None:
        """Persist the frontend debug logging preference."""
        enabled = bool(enabled)
        self.backend.settings.update({DEBUG_ENABLED_SETTING: enabled})
        _apply_debug_logging(enabled)
        decky.logger.info("Set %s=%s", DEBUG_ENABLED_SETTING, enabled)

    async def get_play_time_sync_enabled(self) -> bool:
        """Return whether PlayTime sharing is enabled; off until the user opts in."""
        return is_playtime_sharing_enabled(self.backend.settings)

    async def set_play_time_sync_enabled(self, enabled: bool) -> None:
        """Persist the user's PlayTime sharing choice."""
        enabled = bool(enabled)
        self.backend.settings.update({PLAY_TIME_SYNC_ENABLED_SETTING: enabled})
        decky.logger.info("Set %s=%s", PLAY_TIME_SYNC_ENABLED_SETTING, enabled)

    async def get_retro_achievements(self, rom_path: str) -> object:
        """Fetch the configured user's RetroAchievements progress for one ROM."""
        return await self.backend.achievements.get_progress(rom_path)

    async def get_game_identities(self, games: list[object]) -> list[dict[str, object]]:
        """Identify supported non-Steam game paths in one blocking batch."""
        return await asyncio.to_thread(self.backend.identities.compute, games)

    async def get_device_authorization(self) -> DeviceAuthorizationState:
        """Return the current Activity device authorization state."""
        return self.backend.authorization.get_state()

    async def start_device_authorization(self) -> DeviceAuthorizationState:
        """Start Activity device authorization."""
        return await self.backend.authorization.start()

    async def cancel_device_authorization(self) -> DeviceAuthorizationState:
        """Cancel Activity device authorization."""
        return await self.backend.authorization.cancel()

    async def sign_out_activity(self) -> DeviceAuthorizationState:
        """Remove the saved Activity access token."""
        return await self.backend.authorization.sign_out()

    async def get_activity_user(self) -> ActivityUser | None:
        """Load the current user for the saved Activity access token."""
        return await self.backend.authorization.get_user()

    async def sync_retro_achievements_credentials(self) -> DeviceAuthorizationState:
        """Refresh permitted RetroAchievements credentials without exposing them."""
        return await self.backend.authorization.sync_retro_achievements_credentials()

    async def game_anatomy_handshake(self) -> bool:
        """Report whether the bundled game-anatomy extension is available."""
        return await self.backend.identities.handshake()

    async def recognize_games(self, identities: object) -> list[GameRecognition]:
        """Resolve local game identities to Activity catalog release revisions."""
        return await self.backend.catalog.recognize(identities)

    async def get_activity(
        self, game_id: str, release_id: str, release_revision_id: str
    ) -> ApiResult:
        """Load comments for one recognised game release version."""
        return await self.backend.activity.get_activity(
            game_id, release_id, release_revision_id
        )

    async def get_friends_gameplay(
        self, game_id: str, release_id: str, release_revision_id: str
    ) -> ApiResult:
        """Load friends' gameplay for one recognised game release version."""
        return await self.backend.activity.get_friends_gameplay(
            game_id, release_id, release_revision_id
        )

    async def get_profile_games(
        self, after: str | None = None, limit: int | None = None
    ) -> ApiResult:
        """List the signed-in Activity profile's games, preserving pagination data."""
        return await self.backend.activity.get_profile_games(after, limit)

    async def get_recent_playtime(self) -> ApiResult:
        """List the signed-in Activity profile's recent playtime."""
        return await self.backend.activity.get_recent_playtime()

    async def post_comment(
        self, game_id: str, release_id: str, release_revision_id: str, body: str
    ) -> ApiResult:
        """Create a native Activity comment for one recognised release revision."""
        return await self.backend.activity.post_comment(
            game_id, release_id, release_revision_id, body
        )

    async def delete_comment(
        self,
        game_id: str,
        release_id: str,
        release_revision_id: str,
        comment_id: str,
    ) -> ApiResult:
        """Delete a native Activity comment for one recognised release revision."""
        return await self.backend.activity.delete_comment(
            game_id, release_id, release_revision_id, comment_id
        )

    async def enqueue_playtime(
        self, steam_id: object, app_id: object, started_at: object, ended_at: object
    ) -> bool:
        """Persist one committed PlayTime interval without calling Activity."""
        return await self.backend.playtime.enqueue_playtime(
            steam_id, app_id, started_at, ended_at
        )

    async def get_pending_playtime(self, steam_id: object) -> list[PendingPlaytime]:
        """Return unresolved PlayTime intervals owned by one Steam account."""
        return await self.backend.playtime.get_pending_playtime(steam_id)

    async def record_playtime(
        self,
        game_id: object,
        release_id: object,
        release_revision_id: object,
        started_at: object,
        ended_at: object,
        steam_id: object,
        app_id: object,
    ) -> ApiResult:
        """Upload one resolved, durably queued PlayTime interval."""
        return await self.backend.playtime.record_playtime(
            game_id,
            release_id,
            release_revision_id,
            started_at,
            ended_at,
            steam_id,
            app_id,
        )

    async def _main(self) -> None:
        """Log backend startup."""
        _apply_debug_logging(self.backend.settings.get(DEBUG_ENABLED_SETTING, bool))
        decky.logger.info(
            "Activity plugin loaded; settings=%s", self.backend.settings.path
        )

    async def _unload(self) -> None:
        """Record backend shutdown after draining authorization requests."""
        await self.backend.authorization.shutdown()
        decky.logger.info("Activity plugin unloaded")
