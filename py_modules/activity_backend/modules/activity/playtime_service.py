"""PlayTime RPC service backed by a durable delivery outbox."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from .playtime import (
    PendingPlaytime,
    PlaytimeRequest,
    valid_pending_playtime,
    valid_playtime_request,
)
from .playtime_outbox import PlaytimeBatch, PlaytimeOutbox, PlaytimeStorageError
from .results import (
    ApiFailure,
    ApiResult,
    EndpointFailure,
    EndpointSuccess,
    api_failure,
    api_success,
)

if TYPE_CHECKING:
    import logging
    from collections.abc import Awaitable, Callable

    from activity_backend.modules.authorization.api import ActivityUser, Session

    from .ports import ActivityEndpoint


class PlaytimeService:
    """Coordinate account-gated uploads through a durable additive outbox."""

    def __init__(
        self,
        endpoint: ActivityEndpoint,
        session: Session,
        logger: logging.Logger,
        outbox: PlaytimeOutbox,
        playtime_sync_enabled: Callable[[], bool],
        current_user: Callable[[], Awaitable[ActivityUser | None]],
    ) -> None:
        self._endpoint: ActivityEndpoint = endpoint
        self._session: Session = session
        self._logger: logging.Logger = logger
        self._outbox: PlaytimeOutbox = outbox
        self._playtime_sync_enabled: Callable[[], bool] = playtime_sync_enabled
        self._current_user: Callable[[], Awaitable[ActivityUser | None]] = current_user
        self._lock: asyncio.Lock = asyncio.Lock()

    async def enqueue_playtime(
        self, steam_id: object, app_id: object, started_at: object, ended_at: object
    ) -> bool:
        """Persist one committed interval only when the user opted into sharing."""
        pending = valid_pending_playtime(app_id, started_at, ended_at)
        if not isinstance(steam_id, str) or not steam_id or pending is None:
            self._logger.error("Invalid pending playtime interval")
            return False
        if not self._playtime_sync_enabled():
            self._logger.info("PlayTime interval not queued: sharing is disabled")
            return False
        return self._outbox.enqueue(
            steam_id, pending["appId"], pending["startedAt"], pending["endedAt"]
        )

    async def get_pending_playtime(self, steam_id: object) -> list[PendingPlaytime]:
        """Return only safe-to-retry intervals for the requested Steam account."""
        if not isinstance(steam_id, str) or not steam_id:
            self._logger.error("Invalid pending playtime Steam account")
            return []
        return self._outbox.pending(steam_id)

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
        """Upload an interval once; all ambiguous dispatches stay durably held."""
        request = valid_playtime_request(
            game_id, release_id, release_revision_id, started_at, ended_at
        )
        pending = valid_pending_playtime(app_id, started_at, ended_at)
        if (
            request is None
            or pending is None
            or not isinstance(steam_id, str)
            or not steam_id
        ):
            self._logger.error("Invalid playtime request")
            return api_failure("invalidRequest")

        async with self._lock:
            gate = await self._account_gate(steam_id)
            if isinstance(gate, dict):
                return gate
            bound = self._outbox.bind(steam_id, pending["appId"], request)
            if bound.state == "completed":
                return api_success(None)
            if bound.state in {"in_flight", "held"}:
                return api_failure("deliveryUnknown")
            return await self._deliver(steam_id, bound.app_id, bound.request, gate)

    async def _deliver(
        self, steam_id: str, app_id: int, request: PlaytimeRequest, token: str
    ) -> ApiResult:
        """Send each immutable batch after all pre-dispatch gates succeed."""
        while True:
            claimed = self._outbox.claim(steam_id, app_id, request)
            if isinstance(claimed, str):
                if claimed == "completed":
                    return api_success(None)
                return api_failure("deliveryUnknown")
            result = await self._send_batch(claimed, token)
            settled = self._settle_batch(claimed, result)
            if settled is not None:
                return settled
            gate = self._next_dispatch_gate(token)
            if isinstance(gate, dict):
                return gate
            token = gate

    def _settle_batch(
        self, batch: PlaytimeBatch, result: ApiResult
    ) -> ApiResult | None:
        """Acknowledge, release, or permanently hold one dispatched batch."""
        if result["ok"] is True:
            try:
                completed = self._outbox.acknowledge(batch.id)
            except PlaytimeStorageError:
                self._logger.exception(
                    "Could not acknowledge accepted PlayTime delivery"
                )
                self._hold_batch(
                    batch.id, "acknowledgement persistence failed after HTTP 204"
                )
                return api_failure("deliveryUnknown")
            return api_success(None) if completed else None
        if _is_definite_non_acceptance(result):
            try:
                self._outbox.release(batch.id)
            except PlaytimeStorageError:
                self._logger.exception("Could not release rejected PlayTime delivery")
                self._hold_batch(
                    batch.id,
                    (
                        "release persistence failed after definite "
                        f"HTTP {result['status']} rejection"
                    ),
                )
                return api_failure("deliveryUnknown", result["status"])
            return result
        self._hold_batch(batch.id, f"indeterminate response (HTTP {result['status']})")
        return api_failure("deliveryUnknown", result["status"])

    def _hold_batch(self, batch_id: int, reason: str) -> None:
        """Keep a potentially accepted batch outside automatic retry."""
        try:
            self._outbox.hold(batch_id)
        except PlaytimeStorageError:
            self._logger.exception("Could not hold PlayTime delivery: %s", reason)
        else:
            self._logger.error("PlayTime delivery held: %s", reason)

    async def _send_batch(self, batch: PlaytimeBatch, token: str) -> ApiResult:
        """Treat exceptions and every non-204 response as potentially accepted."""
        try:
            endpoint_result = await self._endpoint.record_playtime(
                batch.sessions, token
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            self._logger.exception(
                "Activity API record playtime raised during dispatch"
            )
            return api_failure("deliveryUnknown")
        if isinstance(endpoint_result, EndpointSuccess):
            if endpoint_result.status == 204:
                return api_success(None)
            self._logger.error(
                "Activity API record playtime returned HTTP %s; only HTTP 204 is "
                "accepted",
                endpoint_result.status,
            )
            return api_failure("invalidResponse", endpoint_result.status)
        return await self._result("record playtime", endpoint_result, token)

    async def _account_gate(self, steam_id: str) -> str | ApiFailure:
        """Verify sharing, session stability, and account identity for each upload."""
        if not self._playtime_sync_enabled():
            self._logger.info(
                "Activity API record playtime skipped: sharing is disabled"
            )
            return api_failure("sharingDisabled")
        token = self._session.access_token()
        if token is None:
            return api_failure("notSignedIn")
        user = await self._current_user()
        if not self._playtime_sync_enabled():
            self._logger.info(
                "Activity API record playtime abandoned: sharing is disabled"
            )
            return api_failure("sharingDisabled")
        if self._session.access_token() != token:
            self._logger.info("Activity API record playtime abandoned: session changed")
            return api_failure("notSignedIn")
        account_id = user.get("steamId") if user is not None else None
        if not isinstance(account_id, str) or not account_id:
            self._logger.error(
                "Could not determine a stable Activity account for playtime"
            )
            return api_failure("invalidResponse")
        if account_id != steam_id:
            self._logger.info(
                "Activity API record playtime held: signed in to another Steam account"
            )
            return api_failure("accountMismatch")
        return token

    def _next_dispatch_gate(self, token: str) -> str | ApiFailure:
        """Recheck mutable dispatch policy before claiming a later batch."""
        if not self._playtime_sync_enabled():
            self._logger.info(
                "Activity API record playtime skipped: sharing is disabled"
            )
            return api_failure("sharingDisabled")
        next_token = self._session.access_token()
        if next_token is None or next_token != token:
            self._logger.info("Activity API record playtime abandoned: session changed")
            return api_failure("notSignedIn")
        return next_token

    async def _result(
        self, operation: str, result: EndpointFailure, token: str
    ) -> ApiFailure:
        if result.error == "unauthorized":
            try:
                await self._session.end_session(token)
            except asyncio.CancelledError:
                raise
            except Exception:
                self._logger.exception("Could not end rejected Activity session")
        self._logger.error(
            "Activity API %s failed: %s (HTTP %s)",
            operation,
            result.error,
            result.status,
        )
        return api_failure(result.error, result.status)


def _is_definite_non_acceptance(result: ApiFailure) -> bool:
    """Only these statuses prove the atomic additive request was not accepted."""
    return result["status"] in frozenset({401, 403, 404, 413, 415, 422, 429})


__all__ = ["PlaytimeService"]
