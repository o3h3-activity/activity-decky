"""Application ports for the authorization capability."""

from collections.abc import Awaitable, Callable
from typing import Protocol

from .models import (
    CurrentUserResult,
    DeviceAuthorizationState,
    DevicePollResult,
    DeviceStartResult,
    RetroAchievementsCredentials,
)


class TokenStore(Protocol):
    """Persisted Activity session credentials owned by authorization."""

    def access_token(self) -> str | None:
        """Return the current non-expired credential, if any."""
        ...

    def expires_at(self) -> str | None:
        """Return the current non-expired credential expiry, if any."""
        ...

    def save(
        self,
        token: str,
        expires_at: str,
        retro_achievements: RetroAchievementsCredentials | None = None,
    ) -> None:
        """Persist a token, expiry, and paired credentials atomically."""
        ...

    def retro_achievements_credentials(self) -> RetroAchievementsCredentials | None:
        """Return credentials paired with the current usable Activity session."""
        ...

    def clear(self) -> None:
        """Remove the persisted session credentials atomically."""
        ...

    def matches(self, token: str) -> bool:
        """Return whether the raw persisted token still equals ``token``."""
        ...


class Session(Protocol):
    """Authorization operations available to authenticated capabilities."""

    def access_token(self) -> str | None:
        """Return the current usable Activity access token."""
        ...

    async def end_session(self, token: str) -> None:
        """End the session only if ``token`` remains current."""
        ...


class DeviceAuthorizationEndpoint(Protocol):
    """Activity API operations required by the device authorization flow."""

    async def start(self) -> DeviceStartResult:
        """Request a device grant."""
        ...

    async def poll(self, device_code: str) -> DevicePollResult:
        """Poll the authorization status of a device grant."""
        ...

    async def get_user(self, token: str) -> CurrentUserResult:
        """Load the current user with a specific credential."""
        ...


AuthorizationStateEmitter = Callable[[DeviceAuthorizationState], Awaitable[None]]
