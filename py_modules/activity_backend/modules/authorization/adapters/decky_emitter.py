"""Decky event adapter for device authorization state updates."""

import decky

from ..models import DeviceAuthorizationState

DEVICE_AUTHORIZATION_EVENT = "device_authorization_changed"


class DeckyAuthorizationEmitter:
    """Publish authorization state changes using the Decky event bridge."""

    async def emit(self, state: DeviceAuthorizationState) -> None:
        """Emit one independent state snapshot to the frontend."""
        await decky.emit(DEVICE_AUTHORIZATION_EVENT, dict(state))
