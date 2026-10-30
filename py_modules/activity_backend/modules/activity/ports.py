"""Inbound dependency contract for Activity RPC application services."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

if TYPE_CHECKING:
    from collections.abc import Sequence

    from .playtime import RecordPlaytimeSession
    from .results import EndpointResult
    from .validation import ActivityQuery, CommentPayload


class ActivityEndpoint(Protocol):
    """Translate validated activity operations to external API calls."""

    async def get_activity(self, query: ActivityQuery, token: str) -> EndpointResult:
        """Request comments for one game release version."""
        ...

    async def get_friends_gameplay(
        self, game_id: str, release_id: str, release_revision_id: str, token: str
    ) -> EndpointResult:
        """Request friends' gameplay for one release version of a game."""
        ...

    async def get_profile_games(
        self, after: str | None, limit: int | None, token: str
    ) -> EndpointResult:
        """List authenticated profile games, optionally after one opaque cursor."""
        ...

    async def get_recent_playtime(self, token: str) -> EndpointResult:
        """List authenticated recent playtime."""
        ...

    async def post_comment(self, payload: CommentPayload, token: str) -> EndpointResult:
        """Create a comment for a release revision of one game."""
        ...

    async def delete_comment(
        self,
        game_id: str,
        release_id: str,
        release_revision_id: str,
        comment_id: str,
        token: str,
    ) -> EndpointResult:
        """Delete one comment of one release revision."""
        ...

    async def record_playtime(
        self, sessions: Sequence[RecordPlaytimeSession], token: str
    ) -> EndpointResult:
        """Atomically add one bounded additive playtime batch."""
        ...


__all__ = ["ActivityEndpoint"]
