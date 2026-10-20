"""HTTP translation for Activity feed and comment operations."""

from __future__ import annotations

from collections.abc import Sequence

from activity_backend.shared import ActivityTransport

from ..ports import ActivityEndpoint
from ..results import EndpointFailure, EndpointResult, EndpointSuccess
from ..validation import ActivityQuery, CommentPayload

ACTIVITY_PATH = "/api/v1/activity"
GAMES_PATH = "/api/v1/games"


class ActivityApiEndpoint(ActivityEndpoint):
    """Map validated Activity operations onto the vendor HTTP API."""

    def __init__(self, transport: ActivityTransport) -> None:
        self._transport: ActivityTransport = transport

    async def get_activity(self, query: ActivityQuery, token: str) -> EndpointResult:
        """Request achievements and Steam BBCode comments for one release version."""
        return await self._send(
            "GET",
            ACTIVITY_PATH,
            (
                ("gameId", query["game_id"]),
                ("releaseId", query["release_id"]),
                ("releaseVersionId", query["release_revision_id"]),
                ("bodyFormat", "steam-bbcode"),
            ),
            None,
            token,
            False,
        )

    async def get_friends_gameplay(
        self,
        game_id: str,
        release_id: str,
        release_revision_id: str,
        token: str,
    ) -> EndpointResult:
        """Request friends' gameplay for one release version of a game."""
        return await self._send(
            "GET",
            f"{GAMES_PATH}/{game_id}/releases/{release_id}"
            f"/versions/{release_revision_id}/friends",
            (),
            None,
            token,
            False,
        )

    async def post_comment(self, payload: CommentPayload, token: str) -> EndpointResult:
        """Create a comment with the endpoint's JSON request shape."""
        return await self._send(
            "POST",
            self._comments_path(
                payload["game_id"],
                payload["release_id"],
                payload["release_revision_id"],
            ),
            (),
            {
                "body": payload["body"],
                "bodyFormat": "steam-bbcode",
            },
            token,
            False,
        )

    async def delete_comment(
        self,
        game_id: str,
        release_id: str,
        release_revision_id: str,
        comment_id: str,
        token: str,
    ) -> EndpointResult:
        """Delete a comment and accept the endpoint's empty success response."""
        return await self._send(
            "DELETE",
            f"{self._comments_path(game_id, release_id, release_revision_id)}/{comment_id}",
            (),
            None,
            token,
            True,
        )

    async def replace_playtime(
        self,
        game_id: str,
        release_id: str,
        release_revision_id: str,
        date: str,
        seconds: int,
        token: str,
    ) -> EndpointResult:
        """Replace one UTC day's playtime total, accepting the API's empty 204."""
        return await self._send(
            "PUT",
            f"/api/v1/me/games/{game_id}/releases/{release_id}"
            f"/versions/{release_revision_id}/playtime/days/{date}",
            (),
            {"seconds": seconds},
            token,
            True,
        )

    @staticmethod
    def _comments_path(game_id: str, release_id: str, release_revision_id: str) -> str:
        return (
            f"{GAMES_PATH}/{game_id}/releases/{release_id}"
            f"/versions/{release_revision_id}/comments"
        )

    async def _send(
        self,
        method: str,
        route_path: str,
        query: Sequence[tuple[str, str]],
        body: object,
        token: str,
        allow_empty_success: bool,
    ) -> EndpointResult:
        response = await self._transport.send(
            method, route_path, query=query, body=body, token=token
        )
        if response is None:
            return EndpointFailure("unreachable", 0)
        if response.status == 401:
            return EndpointFailure("unauthorized", 401)
        if response.status >= 400:
            return EndpointFailure("httpError", response.status)
        if response.body is None and not allow_empty_success:
            return EndpointFailure("invalidResponse", response.status)
        return EndpointSuccess(response.status, response.body)


__all__ = ["ActivityApiEndpoint"]
