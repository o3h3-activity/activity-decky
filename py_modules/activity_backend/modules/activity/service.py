"""Activity and comment RPC application service."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable

from activity_backend.modules.authorization.api import ActivityUser, Session

from .playtime import split_utc_days, valid_playtime_request
from .ports import ActivityEndpoint, PlaytimeTotals
from .results import (
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
        current_user: Callable[[], Awaitable[ActivityUser | None]],
    ) -> None:
        """Bind endpoint translation, the shared session, and diagnostic logging."""
        self._endpoint: ActivityEndpoint = endpoint
        self._session: Session = session
        self._logger: logging.Logger = logger
        self._playtime_totals: PlaytimeTotals = playtime_totals
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

    async def record_playtime(
        self,
        game_id: object,
        release_id: object,
        release_revision_id: object,
        started_at: object,
        ended_at: object,
    ) -> ApiResult:
        """Accumulate a played interval and replace each affected UTC-day total."""
        request = valid_playtime_request(
            game_id, release_id, release_revision_id, started_at, ended_at
        )
        if request is None:
            self._logger.error("Invalid playtime request")
            return api_failure("invalidRequest")

        async with self._playtime_lock:
            token = self._token("record playtime")
            if token is None:
                return api_failure("notSignedIn")
            user = await self._current_user()
            if self._session.access_token() != token:
                self._logger.info(
                    "Activity API record playtime abandoned: session changed"
                )
                return api_failure("notSignedIn")
            account_id = user.get("steamId") if user is not None else None
            if not isinstance(account_id, str) or not account_id:
                self._logger.error(
                    "Could not determine a stable Activity account for playtime"
                )
                return api_failure("invalidResponse")

            ledger = self._playtime_totals.load(
                account_id,
                request["game_id"],
                request["release_id"],
                request["release_revision_id"],
            )
            days = split_utc_days(request["started_at"], request["ended_at"])
            interval = (request["started_at"], request["ended_at"])
            if interval not in ledger.intervals:
                ledger.intervals.add(interval)
                for day, milliseconds in days.items():
                    ledger.days[day] = ledger.days.get(day, 0) + milliseconds
                # Persist before network I/O: failures must not discard elapsed time.
                self._playtime_totals.save(
                    account_id,
                    request["game_id"],
                    request["release_id"],
                    request["release_revision_id"],
                    ledger,
                )

            for day in days:
                if self._session.access_token() != token:
                    self._logger.info(
                        "Activity API record playtime abandoned: session changed"
                    )
                    return api_failure("notSignedIn")
                result = await self._endpoint.replace_playtime(
                    request["game_id"],
                    request["release_id"],
                    request["release_revision_id"],
                    day,
                    ledger.days[day] // 1000,
                    token,
                )
                api_result = await self._result("record playtime", result, token)
                if not api_result["ok"]:
                    return api_result
            return api_success(None)

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


__all__ = ["ActivityProxy"]
