"""Activity transport adapter for device authorization endpoints."""

from typing import cast

from activity_backend.shared import ActivityTransport, HttpJsonResponse

from ..expiry import is_valid_expiry
from ..models import (
    ActivityUser,
    ApprovedToken,
    CurrentUserFailure,
    CurrentUserResult,
    CurrentUserSuccess,
    DeviceGrant,
    DevicePollOutcome,
    DevicePollResult,
    DevicePollSuccess,
    DeviceStartFailure,
    DeviceStartResult,
    DeviceStartSuccess,
    RetroAchievementsCredentials,
)

DEVICE_START_PATH = "/api/v1/auth/device"
DEVICE_TOKEN_PATH = "/api/v1/auth/device/token"  # noqa: S105 -- endpoint, not a secret
CURRENT_USER_PATH = "/api/v1/me"


class ActivityDeviceAuthorizationEndpoint:
    """Translate Activity wire responses into authorization endpoint outcomes."""

    def __init__(self, transport: ActivityTransport) -> None:
        self._transport: ActivityTransport = transport

    async def start(self) -> DeviceStartResult:
        """Request and classify a fresh device authorization grant."""
        return self._decode_start(await self._transport.send("POST", DEVICE_START_PATH))

    async def poll(self, device_code: str) -> DevicePollResult:
        """Poll and classify the authorization status of a device grant."""
        return self._decode_poll(
            await self._transport.send(
                "POST", DEVICE_TOKEN_PATH, body={"deviceCode": device_code}
            )
        )

    async def get_user(self, token: str) -> CurrentUserResult:
        """Load and validate the user identified by a specific bearer token."""
        return self._decode_user(
            await self._transport.send("GET", CURRENT_USER_PATH, token=token)
        )

    @staticmethod
    def _decode_start(response: HttpJsonResponse | None) -> DeviceStartResult:
        """Classify and validate a device authorization response."""
        if response is None:
            return DeviceStartFailure("unreachable")
        if response.status == 429:
            return DeviceStartFailure(
                "rate_limited",
                retry_after_seconds=response.retry_after_seconds,
                http_status=response.status,
            )
        if response.status != 201:
            return DeviceStartFailure("failed", http_status=response.status)
        grant = ActivityDeviceAuthorizationEndpoint._decode_grant(response.body)
        if grant is None:
            return DeviceStartFailure("invalid", http_status=response.status)
        return DeviceStartSuccess(grant, response.status)

    @staticmethod
    def _decode_grant(body: object) -> DeviceGrant | None:
        """Decode the required wire fields of a device authorization grant."""
        if not isinstance(body, dict):
            return None
        values = cast(dict[object, object], body)
        device_code = values.get("deviceCode")
        user_code = values.get("userCode")
        verification_uri = values.get("verificationUri")
        verification_uri_complete = values.get("verificationUriComplete")
        expires_in = values.get("expiresIn")
        interval = values.get("interval")
        if not (
            isinstance(device_code, str)
            and device_code
            and isinstance(user_code, str)
            and user_code
            and isinstance(verification_uri, str)
            and verification_uri
            and isinstance(verification_uri_complete, str)
            and verification_uri_complete
            and type(expires_in) is int
            and expires_in > 0
            and type(interval) is int
            and interval > 0
        ):
            return None
        return DeviceGrant(
            device_code,
            user_code,
            verification_uri,
            verification_uri_complete,
            expires_in,
            interval,
        )

    @staticmethod
    def _decode_poll(response: HttpJsonResponse | None) -> DevicePollResult:
        """Classify and validate one device-token poll response."""
        if response is None:
            return DevicePollOutcome("unreachable")
        if 500 <= response.status < 600:
            return DevicePollOutcome(
                "transient_failure",
                http_status=response.status,
            )
        if response.status != 200:
            return ActivityDeviceAuthorizationEndpoint._decode_poll_error(response)
        return ActivityDeviceAuthorizationEndpoint._decode_poll_success(response)

    @staticmethod
    def _decode_poll_error(response: HttpJsonResponse) -> DevicePollResult:
        """Translate a non-successful device-token status into an outcome."""
        if response.status == 404:
            return DevicePollOutcome("restart", http_status=response.status)
        if response.status == 409:
            return DevicePollOutcome("token_limit", http_status=response.status)
        if response.status == 429:
            return DevicePollOutcome(
                "rate_limited",
                retry_after_seconds=response.retry_after_seconds,
                http_status=response.status,
            )
        if response.status == 422:
            return DevicePollOutcome("rejected", http_status=response.status)
        return DevicePollOutcome("unexpected", http_status=response.status)

    @staticmethod
    def _decode_poll_success(response: HttpJsonResponse) -> DevicePollResult:
        """Decode a successful device-token response into an authorization outcome."""
        if not isinstance(response.body, dict):
            return DevicePollOutcome("invalid", http_status=response.status)
        values = cast(dict[object, object], response.body)
        status = values.get("status")
        if not isinstance(status, str):
            return DevicePollOutcome("invalid", http_status=response.status)
        if status == "pending":
            return DevicePollOutcome("pending", http_status=response.status)
        if status == "slow_down":
            return DevicePollOutcome("slow_down", http_status=response.status)
        if status == "approved":
            approved_token = ActivityDeviceAuthorizationEndpoint._decode_approved_token(
                values
            )
            if approved_token is not None:
                return DevicePollSuccess(approved_token, response.status)
        elif status == "denied" or status == "expired":
            return DevicePollOutcome(status, http_status=response.status)
        return DevicePollOutcome("invalid", http_status=response.status)

    @staticmethod
    def _decode_approved_token(
        values: dict[object, object],
    ) -> ApprovedToken | None:
        """Decode the required wire fields of an approved device token."""
        token = values.get("accessToken")
        token_type = values.get("tokenType")
        expires_at = values.get("expiresAt")
        serialized_retro_achievements = values.get("retroAchievements")
        retro_achievements = (
            ActivityDeviceAuthorizationEndpoint._decode_retro_achievements_credentials(
                serialized_retro_achievements
            )
        )
        if not (
            isinstance(token, str)
            and token
            and isinstance(token_type, str)
            and token_type.lower() == "bearer"
            and is_valid_expiry(expires_at)
            and (
                serialized_retro_achievements is None or retro_achievements is not None
            )
        ):
            return None
        return ApprovedToken(token, expires_at, retro_achievements)

    @staticmethod
    def _decode_retro_achievements_credentials(
        value: object,
    ) -> RetroAchievementsCredentials | None:
        """Decode optional RetroAchievements credentials from an approved response."""
        if not isinstance(value, dict):
            return None
        values = cast(dict[object, object], value)
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

    @staticmethod
    def _decode_user(response: HttpJsonResponse | None) -> CurrentUserResult:
        """Classify and validate one current-user response."""
        if response is None:
            return CurrentUserFailure("unavailable")
        if response.status == 401:
            return CurrentUserFailure("rejected", http_status=response.status)
        if response.status != 200:
            return CurrentUserFailure("unavailable", http_status=response.status)
        if not isinstance(response.body, dict):
            return CurrentUserFailure("invalid", http_status=response.status)
        values = cast(dict[object, object], response.body)
        nickname = values.get("nickname")
        if not isinstance(nickname, str):
            return CurrentUserFailure("invalid", http_status=response.status)
        avatar_url = values.get("avatarUrl")
        steam_id = values.get("steamId")
        user: ActivityUser = {
            "nickname": nickname,
            "avatarUrl": avatar_url if isinstance(avatar_url, str) else None,
            "steamId": steam_id if isinstance(steam_id, str) and steam_id else None,
        }
        return CurrentUserSuccess(user, response.status)
