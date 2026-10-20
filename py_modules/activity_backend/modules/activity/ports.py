"""Inbound dependency contract for Activity RPC application services."""

from __future__ import annotations

from typing import Protocol

from .playtime import PlaytimeLedger
from .results import EndpointResult
from .validation import ActivityQuery, CommentPayload


class ActivityEndpoint(Protocol):
    """Translate validated activity operations to external API calls."""

    async def get_activity(self, query: ActivityQuery, token: str) -> EndpointResult:
        """Request comments for one game release version."""
        ...

    async def get_friends_gameplay(
        self,
        game_id: str,
        release_id: str,
        release_revision_id: str,
        token: str,
    ) -> EndpointResult:
        """Request friends' gameplay for one release version of a game."""
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
        """Delete one comment of one release revision of one game."""
        ...

    async def replace_playtime(
        self,
        game_id: str,
        release_id: str,
        release_revision_id: str,
        date: str,
        seconds: int,
        token: str,
    ) -> EndpointResult:
        """Replace one authenticated user's UTC-day playtime total."""
        ...


class PlaytimeTotals(Protocol):
    """Persist one account's release-version day totals and interval identities."""

    def load(
        self,
        account_id: str,
        game_id: str,
        release_id: str,
        release_revision_id: str,
    ) -> PlaytimeLedger:
        """Load the durable ledger for one account and release version."""
        ...

    def save(
        self,
        account_id: str,
        game_id: str,
        release_id: str,
        release_revision_id: str,
        ledger: PlaytimeLedger,
    ) -> None:
        """Replace the durable ledger for one account and release version."""
        ...


__all__ = ["ActivityEndpoint", "PlaytimeTotals"]
