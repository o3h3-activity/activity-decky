"""Pure input-validation rules for activity and comment operations."""

from __future__ import annotations

import re
from typing import TypedDict, TypeGuard

UUID_PATTERN = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


class ActivityQuery(TypedDict):
    """Validated activity comments query identities."""

    game_id: str
    release_id: str
    release_revision_id: str


class CommentPayload(TypedDict):
    """Validated comment-creation inputs."""

    game_id: str
    release_id: str
    release_revision_id: str
    body: str


def valid_activity_query(
    game_id: object, release_id: object, release_revision_id: object
) -> ActivityQuery | None:
    """Validate game, release, and release-version identities."""
    if not (is_uuid(game_id) and is_uuid(release_id) and is_uuid(release_revision_id)):
        return None
    return {
        "game_id": game_id,
        "release_id": release_id,
        "release_revision_id": release_revision_id,
    }


def valid_comment_payload(
    game_id: object, release_id: object, release_revision_id: object, body: object
) -> CommentPayload | None:
    """Validate a non-empty comment with its game and both release identities."""
    if not (
        is_uuid(game_id)
        and is_uuid(release_id)
        and is_uuid(release_revision_id)
        and isinstance(body, str)
        and body.strip()
    ):
        return None
    return {
        "game_id": game_id,
        "release_id": release_id,
        "release_revision_id": release_revision_id,
        "body": body,
    }


def is_uuid(value: object) -> TypeGuard[str]:
    """Return whether a value is an RFC 4122-shaped UUID string."""
    return isinstance(value, str) and UUID_PATTERN.fullmatch(value) is not None
