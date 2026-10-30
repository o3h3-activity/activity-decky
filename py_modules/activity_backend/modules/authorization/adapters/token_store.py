"""Settings-backed persistence for Activity session credentials."""

from collections.abc import Callable
from datetime import UTC, datetime
from typing import cast

from activity_backend.shared import Settings

from ..expiry import is_expired
from ..models import RetroAchievementsCredentials

ACCESS_TOKEN_SETTING = "activityAccessToken"  # noqa: S105 -- settings key, not a secret
ACCESS_TOKEN_EXPIRES_AT_SETTING = "activityAccessTokenExpiresAt"  # noqa: S105
ACTIVITY_RETRO_ACHIEVEMENTS_SETTING = "activityRetroAchievements"
ACTIVITY_RETRO_ACHIEVEMENTS_CREDENTIAL_SYNC_SETTING = (
    "activityRetroAchievementsCredentialSync"
)


class SettingsTokenStore:
    """Store Activity credentials and remove them once their expiry is unusable."""

    def __init__(
        self,
        settings: Settings,
        *,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
    ) -> None:
        self._settings: Settings = settings
        self._now: Callable[[], datetime] = now

    def access_token(self) -> str | None:
        """Return the saved token unless its expiry is invalid or elapsed."""
        token = self._settings.get(ACCESS_TOKEN_SETTING, str)
        if not token:
            return None
        if is_expired(
            self._settings.get(ACCESS_TOKEN_EXPIRES_AT_SETTING, str), self._now
        ):
            self.clear()
            return None
        return token

    def expires_at(self) -> str | None:
        """Return the expiry for a usable saved token."""
        if self.access_token() is None:
            return None
        return self._settings.get(ACCESS_TOKEN_EXPIRES_AT_SETTING, str)

    def retro_achievements_credentials(self) -> RetroAchievementsCredentials | None:
        """Return credentials only while their paired Activity session is usable."""
        if self.access_token() is None:
            return None
        serialized = self._settings.get(ACTIVITY_RETRO_ACHIEVEMENTS_SETTING, object)
        if not isinstance(serialized, dict):
            return None
        values = cast("dict[object, object]", serialized)
        username = values.get("userName")
        api_key = values.get("apiKey")
        if not (
            isinstance(username, str)
            and username.strip()
            and isinstance(api_key, str)
            and api_key.strip()
        ):
            return None
        return RetroAchievementsCredentials(username, api_key)

    def retro_achievements_credential_sync_permitted(self) -> bool:
        """Return explicit credential-sync permission for the usable session."""
        return bool(self.access_token()) and bool(
            self._settings.get(
                ACTIVITY_RETRO_ACHIEVEMENTS_CREDENTIAL_SYNC_SETTING, bool
            )
        )

    @staticmethod
    def _serialized_credentials(
        credentials: RetroAchievementsCredentials | None,
    ) -> dict[str, str] | None:
        """Serialize credentials only at the settings boundary."""
        if credentials is None:
            return None
        return {"userName": credentials.username, "apiKey": credentials.api_key}

    def save(
        self,
        token: str,
        expires_at: str,
        retro_achievements_credential_sync: bool,
        retro_achievements: RetroAchievementsCredentials | None = None,
    ) -> None:
        """Persist a token, expiry, permission, and paired credentials together."""
        self._settings.update(
            {
                ACCESS_TOKEN_SETTING: token,
                ACCESS_TOKEN_EXPIRES_AT_SETTING: expires_at,
                ACTIVITY_RETRO_ACHIEVEMENTS_CREDENTIAL_SYNC_SETTING: (
                    retro_achievements_credential_sync
                ),
                ACTIVITY_RETRO_ACHIEVEMENTS_SETTING: self._serialized_credentials(
                    retro_achievements
                ),
            }
        )

    def update_retro_achievements_credentials(
        self,
        token: str,
        retro_achievements_credential_sync: bool,
        retro_achievements: RetroAchievementsCredentials | None,
    ) -> bool:
        """Atomically replace only the still-current token's linked credentials."""
        if not self.matches(token):
            return False
        self._settings.update(
            {
                ACTIVITY_RETRO_ACHIEVEMENTS_CREDENTIAL_SYNC_SETTING: (
                    retro_achievements_credential_sync
                ),
                ACTIVITY_RETRO_ACHIEVEMENTS_SETTING: self._serialized_credentials(
                    retro_achievements
                ),
            }
        )
        return True

    def clear(self) -> None:
        """Clear the session, paired credentials, and cached game recognitions."""
        self._settings.update(
            {
                ACCESS_TOKEN_SETTING: None,
                ACCESS_TOKEN_EXPIRES_AT_SETTING: None,
                ACTIVITY_RETRO_ACHIEVEMENTS_CREDENTIAL_SYNC_SETTING: None,
                ACTIVITY_RETRO_ACHIEVEMENTS_SETTING: None,
                "gameRecognitions": None,
            }
        )

    def matches(self, token: str) -> bool:
        """Compare against the raw persisted credential for replacement protection."""
        return self._settings.get(ACCESS_TOKEN_SETTING, str) == token
