"""Activity and comment RPC application service."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from activity_backend.modules.authorization.api import ActivityUser, Session

from .playtime import (
    PendingPlaytime,
    PlaytimeLedger,
    PlaytimeRequest,
    PlaytimeWithdrawal,
    split_utc_days,
    valid_pending_playtime,
    valid_playtime_request,
)
from .ports import ActivityEndpoint, PendingPlaytimeStore, PlaytimeTotals
from .results import (
    ApiFailure,
    ApiResult,
    EndpointResult,
    EndpointSuccess,
    api_failure,
    api_success,
)
from .validation import is_uuid, valid_activity_query, valid_comment_payload


class ActivityProxy:
    """Typed frontend RPC boundary over the Activity endpoint port."""

    def __init__(
        self,
        endpoint: ActivityEndpoint,
        session: Session,
        logger: logging.Logger,
        playtime_totals: PlaytimeTotals,
        pending_playtime: PendingPlaytimeStore,
        playtime_sync_enabled: Callable[[], bool],
        current_user: Callable[[], Awaitable[ActivityUser | None]],
    ) -> None:
        """Bind endpoint translation, the shared session, and diagnostic logging."""
        self._endpoint: ActivityEndpoint = endpoint
        self._session: Session = session
        self._logger: logging.Logger = logger
        self._playtime_totals: PlaytimeTotals = playtime_totals
        self._pending_playtime: PendingPlaytimeStore = pending_playtime
        self._playtime_sync_enabled: Callable[[], bool] = playtime_sync_enabled
        self._current_user: Callable[[], Awaitable[ActivityUser | None]] = current_user
        self._playtime_lock: asyncio.Lock = asyncio.Lock()

    async def get_activity(
        self,
        game_id: object,
        release_id: object,
        release_revision_id: object,
    ) -> ApiResult:
        """Load comments for one game release version."""
        query = valid_activity_query(game_id, release_id, release_revision_id)
        if query is None:
            self._logger.error("Invalid activity request")
            return api_failure("invalidRequest")
        token = self._token("get activity")
        if token is None:
            return api_failure("notSignedIn")
        result = await self._endpoint.get_activity(query, token)
        return await self._result("get activity", result, token)

    async def get_friends_gameplay(
        self,
        game_id: object,
        release_id: object,
        release_revision_id: object,
    ) -> ApiResult:
        """Load friends' gameplay for one release version of a game."""
        if not (
            is_uuid(game_id) and is_uuid(release_id) and is_uuid(release_revision_id)
        ):
            self._logger.error("Invalid friends gameplay route identifier")
            return api_failure("invalidRequest")
        token = self._token("get friends gameplay")
        if token is None:
            return api_failure("notSignedIn")
        result = await self._endpoint.get_friends_gameplay(
            game_id, release_id, release_revision_id, token
        )
        return await self._result("get friends gameplay", result, token)

    async def post_comment(
        self,
        game_id: object,
        release_id: object,
        release_revision_id: object,
        body: object,
    ) -> ApiResult:
        """Create an authenticated comment for one release revision of a game."""
        payload = valid_comment_payload(game_id, release_id, release_revision_id, body)
        if payload is None:
            self._logger.error("Invalid comment payload")
            return api_failure("invalidRequest")
        token = self._token("post comment")
        if token is None:
            return api_failure("notSignedIn")
        result = await self._endpoint.post_comment(payload, token)
        return await self._result("post comment", result, token)

    async def delete_comment(
        self,
        game_id: object,
        release_id: object,
        release_revision_id: object,
        comment_id: object,
    ) -> ApiResult:
        """Delete one authenticated comment and return the empty success body."""
        if not (
            is_uuid(game_id)
            and is_uuid(release_id)
            and is_uuid(release_revision_id)
            and is_uuid(comment_id)
        ):
            self._logger.error("Invalid comment route identifier")
            return api_failure("invalidRequest")
        token = self._token("delete comment")
        if token is None:
            return api_failure("notSignedIn")
        result = await self._endpoint.delete_comment(
            game_id, release_id, release_revision_id, comment_id, token
        )
        return await self._result("delete comment", result, token)

    async def enqueue_playtime(
        self, steam_id: object, app_id: object, started_at: object, ended_at: object
    ) -> bool:
        """Persist a committed interval; only the sharing opt-in gates it, not the session.

        Returns whether the interval was newly queued, not already queued or uploaded.
        """
        pending = valid_pending_playtime(app_id, started_at, ended_at)
        if not isinstance(steam_id, str) or not steam_id or pending is None:
            self._logger.error("Invalid pending playtime interval")
            return False
        if not self._playtime_sync_enabled():
            self._logger.info("PlayTime interval not queued: sharing is disabled")
            return False
        return self._pending_playtime.enqueue(
            steam_id, pending["appId"], pending["startedAt"], pending["endedAt"]
        )

    async def get_pending_playtime(self, steam_id: object) -> list[PendingPlaytime]:
        """Return unresolved intervals owned by the requested Steam account."""
        if not isinstance(steam_id, str) or not steam_id:
            self._logger.error("Invalid pending playtime Steam account")
            return []
        return self._pending_playtime.load(steam_id)

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
        """Upload one interval, queueing it first if absent, under its first bound identity.

        Success acknowledges the interval. A refusal Activity would repeat withdraws the
        interval's time; it stays queued until all affected day totals are restored, then
        is discarded with `refused`.
        """
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

        async with self._playtime_lock:
            if not self._playtime_sync_enabled():
                self._logger.info(
                    "Activity API record playtime skipped: sharing is disabled"
                )
                return api_failure("sharingDisabled")
            token = self._token("record playtime")
            if token is None:
                return api_failure("notSignedIn")
            bound = self._pending_playtime.bind(steam_id, pending["appId"], request)
            if bound is None:
                # Already uploaded: a retried RPC whose earlier response was lost.
                return api_success(None)
            failure = await self._verify_playtime_account(steam_id, token)
            if failure is not None:
                return failure

            interval = (pending["appId"], pending["startedAt"], pending["endedAt"])
            result = await self._upload_playtime(steam_id, bound, token)
            if result["ok"] is True:
                self._pending_playtime.acknowledge(steam_id, *interval)
            elif result["error"] == "refused":
                self._pending_playtime.discard(steam_id, *interval)
            return result

    async def _upload_playtime(
        self, account_id: str, request: PlaytimeRequest, token: str
    ) -> ApiResult:
        """Accumulate once and replace all days while the recording lock is held."""
        ledger = self._playtime_totals.load(
            account_id,
            request["game_id"],
            request["release_id"],
            request["release_revision_id"],
        )
        interval = (request["started_at"], request["ended_at"])
        withdrawal = ledger.withdrawals.get(interval)
        if withdrawal is None:
            days = split_utc_days(*interval)
            if ledger.add(interval, days):
                # Persist before network I/O: failures must not discard elapsed time.
                self._save_ledger(account_id, request, ledger)
            for day in days:
                result = await self._replace_day(request, day, ledger, token)
                if result["ok"] is True:
                    continue
                if not _is_refused(result):
                    return result
                self._logger.error(
                    "Activity refused playtime interval; withdrawing it (HTTP %s)",
                    result["status"],
                )
                withdrawal = ledger.withdraw(interval, days, result["status"])
                # Persist before restoring: a retry must restore, never accumulate again.
                self._save_ledger(account_id, request, ledger)
                break
            if withdrawal is None:
                return api_success(None)
        return await self._restore_playtime(
            account_id, request, ledger, withdrawal, token
        )

    async def _restore_playtime(
        self,
        account_id: str,
        request: PlaytimeRequest,
        ledger: PlaytimeLedger,
        withdrawal: PlaytimeWithdrawal,
        token: str,
    ) -> ApiResult:
        """Rewrite all affected days without the refused time, then report the refusal.

        A rewrite Activity refuses too would be refused on every retry, so it is skipped.
        """
        for day in withdrawal.days:
            restored = await self._replace_day(request, day, ledger, token)
            if restored["ok"] is False and not _is_refused(restored):
                return restored
        if withdrawal.days:
            withdrawal.days.clear()
            self._save_ledger(account_id, request, ledger)
        return api_failure("refused", withdrawal.status)

    async def _replace_day(
        self, request: PlaytimeRequest, day: str, ledger: PlaytimeLedger, token: str
    ) -> ApiResult:
        """Replace one UTC day's total with the ledger's floored seconds, if still allowed."""
        failure = self._playtime_blocked(token)
        if failure is not None:
            return failure
        result = await self._endpoint.replace_playtime(
            request["game_id"],
            request["release_id"],
            request["release_revision_id"],
            day,
            ledger.days.get(day, 0) // 1000,
            token,
        )
        return await self._result("record playtime", result, token)

    def _save_ledger(
        self, account_id: str, request: PlaytimeRequest, ledger: PlaytimeLedger
    ) -> None:
        self._playtime_totals.save(
            account_id,
            request["game_id"],
            request["release_id"],
            request["release_revision_id"],
            ledger,
        )

    def _playtime_blocked(self, token: str) -> ApiFailure | None:
        """Stop delivery once sharing is turned off or the session that began it changed."""
        if not self._playtime_sync_enabled():
            self._logger.info(
                "Activity API record playtime abandoned: sharing is disabled"
            )
            return api_failure("sharingDisabled")
        if self._session.access_token() != token:
            self._logger.info("Activity API record playtime abandoned: session changed")
            return api_failure("notSignedIn")
        return None

    async def _verify_playtime_account(
        self, steam_id: str, token: str
    ) -> ApiFailure | None:
        """Verify the current Activity user still owns the queued Steam interval."""
        user = await self._current_user()
        failure = self._playtime_blocked(token)
        if failure is not None:
            return failure
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
        return None

    def _token(self, operation: str) -> str | None:
        token = self._session.access_token()
        if token is None:
            self._logger.info("Activity API %s skipped: not signed in", operation)
        return token

    async def _result(
        self, operation: str, result: EndpointResult, token: str
    ) -> ApiResult:
        if isinstance(result, EndpointSuccess):
            return api_success(result.data)
        if result.error == "unauthorized":
            await self._session.end_session(token)
        self._logger.error(
            "Activity API %s failed: %s (HTTP %s)",
            operation,
            result.error,
            result.status,
        )
        return api_failure(result.error, result.status)


# Activity's day replacement answers 404 for an unknown game, release, or version and
# 422 for an invalid day or total. Both concern the interval's pinned identity or time,
# so a retry would be refused again; every other failure may succeed later.
_REFUSED_STATUSES = frozenset({404, 422})


def _is_refused(result: ApiFailure) -> bool:
    """Activity refused the interval itself, so every retry would be refused too."""
    return result["error"] == "httpError" and result["status"] in _REFUSED_STATUSES


__all__ = ["ActivityProxy"]
