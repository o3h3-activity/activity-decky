"""Small I/O contracts shared by capability modules; no feature policy."""

from collections.abc import Mapping, Sequence
from typing import NamedTuple, Protocol, TypeVar

T = TypeVar("T")


class HttpJsonResponse(NamedTuple):
    """HTTP status, decoded JSON body, and bounded retry metadata."""

    status: int
    body: object
    retry_after_seconds: int


class Settings(Protocol):
    """Typed access to persistent values; modules own their keys."""

    def get(self, key: str, kind: type[T]) -> T | None: ...

    def update(self, changes: Mapping[str, object]) -> None: ...


class ActivityTransport(Protocol):
    """Cancellation-safe Activity transport without credential policy."""

    async def send(
        self,
        method: str,
        route_path: str,
        *,
        query: Sequence[tuple[str, str]] = (),
        body: object = None,
        token: str | None = None,
    ) -> HttpJsonResponse | None: ...
