"""Activity API URL construction and cancellation-safe HTTP transport."""

import asyncio
from collections.abc import Sequence
from urllib.parse import urlencode, urlsplit, urlunsplit

from activity_backend.infrastructure.http_client import request_json_status
from activity_backend.shared import HttpJsonResponse

EVENT_API_BASE_URL = "https://activity.o3h3.com/api"


def _join_api_path(base_path: str, route_path: str) -> str:
    """Join a configured API base path without duplicating its prefix."""
    base = base_path.rstrip("/")
    route = f"/{route_path.lstrip('/')}"
    if base and (route == base or route.startswith(f"{base}/")):
        return route
    return f"{base}{route}"


class ActivityApiClient:
    """Activity origin and off-loop requests; authorization owns credentials."""

    def __init__(self, base_url: str = EVENT_API_BASE_URL) -> None:
        self._base_url: str = base_url

    def url(self, route_path: str, query: Sequence[tuple[str, str]] = ()) -> str:
        """Build an Activity route URL with ordered query pairs."""
        origin = urlsplit(self._base_url)
        return urlunsplit(
            (
                origin.scheme,
                origin.netloc,
                _join_api_path(origin.path, route_path),
                urlencode(list(query)),
                "",
            )
        )

    async def send(
        self,
        method: str,
        route_path: str,
        *,
        query: Sequence[tuple[str, str]] = (),
        body: object = None,
        token: str | None = None,
    ) -> HttpJsonResponse | None:
        """Drain a blocking request before propagating caller cancellation."""
        request_task = asyncio.create_task(
            asyncio.to_thread(
                request_json_status,
                self.url(route_path, query),
                method=method,
                body=body,
                bearer_token=token,
            )
        )
        try:
            return await asyncio.shield(request_task)
        except asyncio.CancelledError:
            try:
                await request_task
            except Exception:  # noqa: S110 -- preserve cancellation after draining the worker
                pass
            raise
