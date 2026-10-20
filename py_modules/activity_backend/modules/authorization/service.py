"""Device authorization use case and session lifecycle."""

import asyncio
import time
from collections.abc import Awaitable, Callable
from logging import Logger
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from .models import (
    ActivityUser,
    ApprovedToken,
    DeviceAuthorizationState,
    DeviceAuthorizationStatus,
    DeviceGrant,
    DevicePollResult,
    RetroAchievementsCredentials,
)
from .polling import PollingCadence
from .ports import AuthorizationStateEmitter, DeviceAuthorizationEndpoint, TokenStore

MESSAGE_UNREACHABLE = "Could not reach the Activity API."
MESSAGE_START_RATE_LIMITED = "Too many sign-in attempts. Wait a moment, then try again."
MESSAGE_START_FAILED = "Could not start sign-in (HTTP {status})."
MESSAGE_INVALID_RESPONSE = "The Activity API returned an unexpected response."
MESSAGE_POLL_REJECTED = "The Activity API rejected the sign-in request."
MESSAGE_POLL_UNEXPECTED = "Unexpected response from the Activity API (HTTP {status})."
MESSAGE_TOKEN_LIMIT = "Your Activity account has too many access tokens. Revoke one at {url}; this code keeps waiting until it expires."  # noqa: S105 -- user-facing message, not a credential
MESSAGE_SESSION_ENDED = "Your Activity sign-in expired or was revoked. Sign in again."

ACCESS_TOKENS_PAGE_PATH = "/settings/access-tokens"


def _access_tokens_url(verification_uri: str) -> str:
    """Build the Activity access-token page URL on the verification host."""
    parsed = urlsplit(verification_uri)
    return urlunsplit((parsed.scheme, parsed.netloc, ACCESS_TOKENS_PAGE_PATH, "", ""))


class DeviceAuthorizationClient:
    """Persisted Activity session with lifecycle-owned device-code polling."""

    def __init__(
        self,
        token_store: TokenStore,
        endpoint: DeviceAuthorizationEndpoint,
        logger: Logger,
        emitter: AuthorizationStateEmitter,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        wall_clock: Callable[[], float] = time.time,
    ) -> None:
        """Bind application ports and polling dependencies."""
        self._token_store: TokenStore = token_store
        self._endpoint: DeviceAuthorizationEndpoint = endpoint
        self._logger: Logger = logger
        self._emitter: AuthorizationStateEmitter = emitter
        self._clock: Callable[[], float] = clock
        self._sleep: Callable[[float], Awaitable[None]] = sleep
        self._wall_clock: Callable[[], float] = wall_clock
        self._task: asyncio.Task[None] | None = None
        self._lifecycle_lock: asyncio.Lock = asyncio.Lock()
        self._authorization_generation: int = 0
        self._start_retry_deadline: float = 0.0
        self._state: DeviceAuthorizationState = self._idle_state("")

    def access_token(self) -> str | None:
        """Return the current usable token through the authorization session API."""
        return self._token_store.access_token()

    def retro_achievements_credentials(self) -> RetroAchievementsCredentials | None:
        """Return credentials paired with the current usable Activity session."""
        return self._token_store.retro_achievements_credentials()

    def _idle_state(self, message: str) -> DeviceAuthorizationState:
        """Build the non-polling state from the usable persisted session."""
        token = self.access_token()

        if token:
            status: DeviceAuthorizationStatus = "signedIn"
            token_expires_at = self._token_store.expires_at() or ""
        else:
            status = "signedOut"
            token_expires_at = ""

        return {
            "accessTokensUrl": "",
            "codeExpiresAt": 0,
            "message": message,
            "retroAchievementsLinked": bool(token)
            and self.retro_achievements_credentials() is not None,
            "status": status,
            "tokenExpiresAt": token_expires_at,
            "userCode": "",
            "verificationUri": "",
            "verificationUriComplete": "",
        }

    @staticmethod
    def _blank_state(
        status: DeviceAuthorizationStatus, message: str = ""
    ) -> DeviceAuthorizationState:
        """Build a state with no active device-code details."""
        return {
            "accessTokensUrl": "",
            "codeExpiresAt": 0,
            "message": message,
            "retroAchievementsLinked": False,
            "status": status,
            "tokenExpiresAt": "",
            "userCode": "",
            "verificationUri": "",
            "verificationUriComplete": "",
        }

    @staticmethod
    def _pending_state(
        started: DeviceGrant, message: str, code_expires_at: int
    ) -> DeviceAuthorizationState:
        """Build the visible state for an active device code."""
        return {
            "accessTokensUrl": _access_tokens_url(started.verification_uri),
            "codeExpiresAt": code_expires_at,
            "message": message,
            "retroAchievementsLinked": False,
            "status": "pending",
            "tokenExpiresAt": "",
            "userCode": started.user_code,
            "verificationUri": started.verification_uri,
            "verificationUriComplete": started.verification_uri_complete,
        }

    async def _set_state(self, state: DeviceAuthorizationState) -> None:
        """Store and broadcast the latest authorization state."""
        self._state = state
        await self._emitter(state.copy())

    def get_state(self) -> DeviceAuthorizationState:
        """Return current authorization, rechecking a signed-in credential."""
        if self._state["status"] == "signedIn":
            self._state = self._idle_state(self._state["message"])
        return self._state.copy()

    async def _cancel_task(self) -> None:
        """Cancel and drain polling without changing visible state."""
        task = self._task
        self._task = None
        if task is None or task.done():
            return
        _ = task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            self._logger.exception(
                "Activity authorization task failed during cancellation"
            )

    async def start(self) -> DeviceAuthorizationState:
        """Begin a new device authorization, replacing any active grant."""
        async with self._lifecycle_lock:
            self._authorization_generation += 1
            await self._cancel_task()
            if self._clock() < self._start_retry_deadline:
                await self._error(MESSAGE_START_RATE_LIMITED)
                return self.get_state()
            await self._set_state(self._blank_state("starting"))
            self._task = asyncio.create_task(self._run())
            return self.get_state()

    async def cancel(self) -> DeviceAuthorizationState:
        """Stop polling and return to the persisted authorization state."""
        async with self._lifecycle_lock:
            self._authorization_generation += 1
            await self._cancel_task()
            await self._set_state(self._idle_state(""))
            return self.get_state()

    async def sign_out(self) -> DeviceAuthorizationState:
        """Remove the persisted Activity access token."""
        async with self._lifecycle_lock:
            self._authorization_generation += 1
            await self._cancel_task()
            self._token_store.clear()
            self._logger.info("Activity access token removed")
            await self._set_state(self._idle_state(""))
            return self.get_state()

    async def end_session(self, token: str) -> None:
        """End a rejected session unless another token has replaced it."""
        async with self._lifecycle_lock:
            if not self._token_store.matches(token):
                return
            await self._end_session_locked()

    async def _end_session_locked(self) -> None:
        """Clear the current token and publish its rejected-session state."""
        self._authorization_generation += 1
        await self._cancel_task()
        self._token_store.clear()
        self._logger.info("Activity access token rejected; removed")
        await self._set_state(self._blank_state("signedOut", MESSAGE_SESSION_ENDED))

    async def shutdown(self) -> None:
        """Cancel and drain polling during unload without emitting an event."""
        async with self._lifecycle_lock:
            self._authorization_generation += 1
            await self._cancel_task()

    async def _error(self, message: str) -> None:
        """Publish a terminal error state."""
        await self._set_state(self._blank_state("error", message))

    async def _run(self) -> None:
        """Start and poll device grants until one reaches a terminal state."""
        while True:
            started = await self._request_start()
            if started is None:
                return
            self._logger.info(
                "Device authorization started; userCode=%s", started.user_code
            )
            if not await self._poll(started):
                return
            await self._set_state(self._blank_state("starting"))

    async def _request_start(self) -> DeviceGrant | None:
        """Request a fresh device authorization grant."""
        result = await self._endpoint.start()
        if result.kind == "started":
            return result.grant
        if result.kind == "unreachable":
            await self._error(MESSAGE_UNREACHABLE)
            return None
        if result.kind == "rate_limited":
            self._start_retry_deadline = self._clock() + result.retry_after_seconds
            await self._error(MESSAGE_START_RATE_LIMITED)
            return None
        if result.kind == "failed":
            await self._error(MESSAGE_START_FAILED.format(status=result.http_status))
            return None
        await self._error(MESSAGE_INVALID_RESPONSE)
        return None

    async def _poll(self, started: DeviceGrant) -> bool:
        """Poll one grant, returning true only when it must be restarted."""
        deadline = self._clock() + started.expires_in
        code_expires_at = round((self._wall_clock() + started.expires_in) * 1000)
        cadence = PollingCadence(started.interval)
        while await self._wait_for_next_poll(
            started, deadline, code_expires_at, cadence
        ):
            result = await self._endpoint.poll(started.device_code)
            if self._clock() >= deadline:
                break
            decision = await self._process_poll_response(started, result, cadence)
            if decision == "restart":
                return True
            if decision == "stop":
                return False
        await self._set_state(self._blank_state("expired"))
        return False

    async def _wait_for_next_poll(
        self,
        started: DeviceGrant,
        deadline: float,
        code_expires_at: int,
        cadence: PollingCadence,
    ) -> bool:
        """Publish and wait for the next poll unless the grant has expired."""
        remaining = deadline - self._clock()
        if remaining <= 0:
            return False
        delay = cadence.next_delay(remaining)
        await self._set_state(
            self._pending_state(started, cadence.message, code_expires_at)
        )
        await self._sleep(delay)
        return self._clock() < deadline

    async def _process_poll_response(
        self,
        started: DeviceGrant,
        result: DevicePollResult,
        cadence: PollingCadence,
    ) -> Literal["continue", "restart", "stop"]:
        """Apply one semantic device-token outcome to the active grant."""
        if result.kind in {"unreachable", "transient_failure"}:
            cadence.increase_failure_backoff()
            return "continue"
        cadence.reset_failure_backoff()
        if result.kind == "pending":
            return "continue"
        if result.kind == "slow_down":
            cadence.slow_down()
            return "continue"
        if result.kind == "restart":
            self._logger.info("Device authorization grant is gone; starting a new one")
            return "restart"
        if result.kind == "token_limit":
            cadence.message = MESSAGE_TOKEN_LIMIT.format(
                url=_access_tokens_url(started.verification_uri)
            )
            return "continue"
        if result.kind == "rate_limited":
            cadence.rate_limit(result.retry_after_seconds)
            return "continue"
        await self._finish_poll(result)
        return "stop"

    async def _finish_poll(self, result: DevicePollResult) -> None:
        """Publish a terminal grant outcome or persist its approved credential."""
        if result.kind == "approved":
            await self._save_approved_token(result.approved_token)
            return
        if result.kind == "denied" or result.kind == "expired":
            await self._set_state(self._blank_state(result.kind))
            return
        if result.kind == "rejected":
            await self._error(MESSAGE_POLL_REJECTED)
            return
        if result.kind == "unexpected":
            await self._error(MESSAGE_POLL_UNEXPECTED.format(status=result.http_status))
            return
        await self._error(MESSAGE_INVALID_RESPONSE)

    async def _save_approved_token(self, approved_token: ApprovedToken) -> None:
        """Persist an approved bearer token, expiry, and paired credentials."""
        async with self._lifecycle_lock:
            self._token_store.save(
                approved_token.token,
                approved_token.expires_at,
                approved_token.retro_achievements,
            )
            self._authorization_generation += 1
        self._logger.info(
            "Activity access token saved; expiresAt=%s", approved_token.expires_at
        )
        await self._set_state(self._idle_state(""))

    async def get_user(self) -> ActivityUser | None:
        """Load the current user for the persisted Activity access token."""
        async with self._lifecycle_lock:
            token = self.access_token()
            generation = self._authorization_generation
            if token is None and self._state["status"] == "signedIn":
                await self._set_state(self._idle_state(""))
        if not token:
            return None
        result = await self._endpoint.get_user(token)
        async with self._lifecycle_lock:
            if (
                generation != self._authorization_generation
                or not self._token_store.matches(token)
            ):
                return None
            if result.kind == "loaded":
                return result.user
            if result.kind == "rejected":
                await self._end_session_locked()
                return None
        self._logger.error(
            "Could not load Activity user (status=%s)", result.http_status
        )
        return None
