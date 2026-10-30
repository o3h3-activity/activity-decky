"""Activity feed and comments RPC application service."""

from __future__ import annotations

from typing import TYPE_CHECKING

from activity_backend.identifiers import is_uuid

from .results import (
    ApiResult,
    EndpointResult,
    EndpointSuccess,
    api_failure,
    api_success,
)
from .validation import valid_activity_query, valid_comment_payload

if TYPE_CHECKING:
    import logging

    from activity_backend.modules.authorization.api import Session

    from .ports import ActivityEndpoint


class ActivityProxy:
    """Typed frontend RPC boundary for Activity feed and comments routes."""

    def __init__(
        self, endpoint: ActivityEndpoint, session: Session, logger: logging.Logger
    ) -> None:
        self._endpoint: ActivityEndpoint = endpoint
        self._session: Session = session
        self._logger: logging.Logger = logger

    async def get_activity(
        self, game_id: object, release_id: object, release_revision_id: object
    ) -> ApiResult:
        """Load comments for one game release version."""
        query = valid_activity_query(game_id, release_id, release_revision_id)
        if query is None:
            self._logger.error("Invalid activity request")
            return api_failure("invalidRequest")
        token = self._token("get activity")
        if token is None:
            return api_failure("notSignedIn")
        return await self._result(
            "get activity", await self._endpoint.get_activity(query, token), token
        )

    async def get_friends_gameplay(
        self, game_id: object, release_id: object, release_revision_id: object
    ) -> ApiResult:
        """Load friends' gameplay for one release version."""
        if not (
            is_uuid(game_id) and is_uuid(release_id) and is_uuid(release_revision_id)
        ):
            self._logger.error("Invalid friends gameplay route identifier")
            return api_failure("invalidRequest")
        token = self._token("get friends gameplay")
        if token is None:
            return api_failure("notSignedIn")
        return await self._result(
            "get friends gameplay",
            await self._endpoint.get_friends_gameplay(
                game_id, release_id, release_revision_id, token
            ),
            token,
        )

    async def get_profile_games(
        self, after: object = None, limit: object = None
    ) -> ApiResult:
        """List authenticated profile games without transforming their response."""
        if (after is not None and not isinstance(after, str)) or (
            limit is not None
            and (not isinstance(limit, int) or isinstance(limit, bool) or limit <= 0)
        ):
            self._logger.error("Invalid profile games pagination")
            return api_failure("invalidRequest")
        token = self._token("get profile games")
        if token is None:
            return api_failure("notSignedIn")
        return await self._result(
            "get profile games",
            await self._endpoint.get_profile_games(after, limit, token),
            token,
        )

    async def get_recent_playtime(self) -> ApiResult:
        """Load the authenticated user's recent playtime response unchanged."""
        token = self._token("get recent playtime")
        if token is None:
            return api_failure("notSignedIn")
        return await self._result(
            "get recent playtime",
            await self._endpoint.get_recent_playtime(token),
            token,
        )

    async def post_comment(
        self,
        game_id: object,
        release_id: object,
        release_revision_id: object,
        body: object,
    ) -> ApiResult:
        """Create an authenticated comment for one release revision."""
        payload = valid_comment_payload(game_id, release_id, release_revision_id, body)
        if payload is None:
            self._logger.error("Invalid comment payload")
            return api_failure("invalidRequest")
        token = self._token("post comment")
        if token is None:
            return api_failure("notSignedIn")
        return await self._result(
            "post comment", await self._endpoint.post_comment(payload, token), token
        )

    async def delete_comment(
        self,
        game_id: object,
        release_id: object,
        release_revision_id: object,
        comment_id: object,
    ) -> ApiResult:
        """Delete one comment of one release revision."""
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
        return await self._result(
            "delete comment",
            await self._endpoint.delete_comment(
                game_id, release_id, release_revision_id, comment_id, token
            ),
            token,
        )

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
