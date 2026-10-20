"""Authorization data structures and endpoint outcomes."""

from dataclasses import dataclass, field
from typing import Literal, TypedDict

DeviceAuthorizationStatus = Literal[
    "signedOut", "starting", "pending", "signedIn", "denied", "expired", "error"
]


class DeviceAuthorizationState(TypedDict):
    """Authorization state returned to the frontend."""

    accessTokensUrl: str
    codeExpiresAt: int
    message: str
    retroAchievementsLinked: bool
    status: DeviceAuthorizationStatus
    tokenExpiresAt: str
    userCode: str
    verificationUri: str
    verificationUriComplete: str


class ActivityUser(TypedDict):
    """Current Activity user returned to the frontend."""

    nickname: str
    avatarUrl: str | None
    steamId: str | None


@dataclass(frozen=True, slots=True)
class RetroAchievementsCredentials:
    """RetroAchievements credentials paired with an Activity session."""

    username: str = field(repr=False)
    api_key: str = field(repr=False)


@dataclass(frozen=True, slots=True)
class DeviceGrant:
    """Validated device authorization grant returned by Activity."""

    device_code: str
    user_code: str
    verification_uri: str
    verification_uri_complete: str
    expires_in: int
    interval: int


@dataclass(frozen=True, slots=True)
class ApprovedToken:
    """Validated bearer token returned by an approved device grant."""

    token: str
    expires_at: str
    retro_achievements: RetroAchievementsCredentials | None = field(
        default=None, repr=False
    )


@dataclass(frozen=True, slots=True)
class DeviceStartSuccess:
    """A successfully created device authorization grant."""

    grant: DeviceGrant
    http_status: int
    kind: Literal["started"] = field(init=False, default="started")


@dataclass(frozen=True, slots=True)
class DeviceStartFailure:
    """A device authorization start outcome without a grant."""

    kind: Literal["rate_limited", "failed", "invalid", "unreachable"]
    retry_after_seconds: int = 0
    http_status: int | None = None


DeviceStartResult = DeviceStartSuccess | DeviceStartFailure


@dataclass(frozen=True, slots=True)
class DevicePollSuccess:
    """An approved device authorization grant with its bearer token."""

    approved_token: ApprovedToken
    http_status: int
    kind: Literal["approved"] = field(init=False, default="approved")


@dataclass(frozen=True, slots=True)
class DevicePollOutcome:
    """A device-token poll outcome without an approved bearer token."""

    kind: Literal[
        "pending",
        "slow_down",
        "denied",
        "expired",
        "restart",
        "token_limit",
        "rate_limited",
        "rejected",
        "unexpected",
        "transient_failure",
        "invalid",
        "unreachable",
    ]
    retry_after_seconds: int = 0
    http_status: int | None = None


DevicePollResult = DevicePollSuccess | DevicePollOutcome


@dataclass(frozen=True, slots=True)
class CurrentUserSuccess:
    """A successfully loaded Activity user."""

    user: ActivityUser
    http_status: int
    kind: Literal["loaded"] = field(init=False, default="loaded")


@dataclass(frozen=True, slots=True)
class CurrentUserFailure:
    """A current-user outcome without an Activity user."""

    kind: Literal["rejected", "invalid", "unavailable"]
    http_status: int | None = None


CurrentUserResult = CurrentUserSuccess | CurrentUserFailure
