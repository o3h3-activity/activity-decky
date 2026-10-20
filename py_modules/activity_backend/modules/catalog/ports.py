"""Inbound dependency contracts for catalog recognition."""

from __future__ import annotations

from typing import Protocol

from activity_backend.modules.authorization.api import Session

from .recognition import (
    GameIdentity,
    RecognitionCacheEntry,
    RecognitionEndpointResult,
)


class RecognitionCache(Protocol):
    """Durable cache of catalog-recognition answers."""

    def load(self) -> dict[str, RecognitionCacheEntry]:
        """Load the complete typed cache mapping."""
        ...

    def save(self, cache: dict[str, RecognitionCacheEntry]) -> None:
        """Persist the complete typed cache mapping."""
        ...


class RecognitionEndpoint(Protocol):
    """Translate one recognition request to the remote catalog service."""

    async def recognize(
        self, identity: GameIdentity, token: str
    ) -> RecognitionEndpointResult:
        """Return a classified endpoint result for one identity."""
        ...


__all__ = ["RecognitionCache", "RecognitionEndpoint", "Session"]
