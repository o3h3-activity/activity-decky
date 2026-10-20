"""Blocking JSON-over-HTTP helper shared by backend integrations."""

import json
import ssl
from email.message import Message
from http.client import HTTPResponse
from typing import cast
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

import decky
from activity_backend.shared import HttpJsonResponse

REQUEST_TIMEOUT_SECONDS = 10
MAX_RETRY_AFTER_SECONDS = 24 * 60 * 60
MAX_LOGGED_BODY_CHARACTERS = 1000
USER_AGENT = f"ActivityDecky/{decky.DECKY_PLUGIN_VERSION} (Linux)"
SYSTEM_CA_BUNDLE = "/etc/ssl/certs/ca-certificates.crt"


def _default_ssl_context() -> ssl.SSLContext:
    """Build the verifying TLS context from the host CA bundle; Decky's bundled Python lacks a usable CA store."""
    try:
        return ssl.create_default_context(cafile=SYSTEM_CA_BUNDLE)
    except OSError as error:
        decky.logger.warning(
            "System CA bundle %s unavailable (%s); using Python defaults",
            SYSTEM_CA_BUNDLE,
            error,
        )
        return ssl.create_default_context()


DEFAULT_SSL_CONTEXT = _default_ssl_context()


def _retry_after_seconds(headers: Message | None) -> int:
    """Return a bounded non-negative Retry-After delay, or the defensive default."""
    value = headers.get("Retry-After") if headers is not None else None
    if not isinstance(value, str):
        return 0
    value = value.strip()
    if not value.isascii() or not value.isdecimal():
        return 0
    try:
        return min(int(value), MAX_RETRY_AFTER_SECONDS)
    except ValueError:
        return 0


def _decode_json(raw: bytes) -> object:
    """Decode a JSON response body, returning None for empty or invalid data."""
    if not raw:
        return None
    try:
        return cast(object, json.loads(raw.decode("utf-8")))
    except ValueError:
        return None


def _request_id(headers: Message | None) -> str:
    """Return the server's request id for correlating its logs, or a placeholder."""
    value = headers.get("x-request-id") if headers is not None else None
    return value if isinstance(value, str) else "-"


def _body_excerpt(raw: bytes) -> str:
    """Return a bounded, printable response body for diagnostics."""
    text = raw.decode("utf-8", errors="replace").strip()
    if not text:
        return "<empty body>"
    if len(text) > MAX_LOGGED_BODY_CHARACTERS:
        return f"{text[:MAX_LOGGED_BODY_CHARACTERS]}… ({len(text)} chars)"
    return text


def request_json_status(
    url: str,
    *,
    method: str = "GET",
    body: object = None,
    form: dict[str, str] | None = None,
    bearer_token: str | None = None,
) -> HttpJsonResponse | None:
    """Perform a blocking HTTP request and return its status, JSON body, and retry metadata."""
    parts = urlsplit(url)
    headers = {"Accept": "application/json", "User-Agent": USER_AGENT}
    data: bytes | None = None
    if form is not None:
        data = urlencode(form).encode("utf-8")
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    elif body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    if bearer_token is not None:
        headers["Authorization"] = f"Bearer {bearer_token}"

    try:
        # Only configured HTTPS origins reach this transport; S310 is a scheme audit.
        request = Request(url, data=data, headers=headers, method=method)  # noqa: S310
        with cast(
            HTTPResponse,
            urlopen(  # noqa: S310 -- configured HTTPS origins, verified TLS context
                request, timeout=REQUEST_TIMEOUT_SECONDS, context=DEFAULT_SSL_CONTEXT
            ),
        ) as response:
            raw = response.read()
            payload = _decode_json(raw)
            if raw and payload is None:
                decky.logger.error(
                    "Invalid JSON from %s %s%s (HTTP %s): %s",
                    method,
                    parts.netloc,
                    parts.path,
                    response.status,
                    _body_excerpt(raw),
                )
            return HttpJsonResponse(
                response.status, payload, _retry_after_seconds(response.headers)
            )
    except HTTPError as error:
        try:
            raw = error.read()
        except OSError:
            raw = b""
        # Query strings are omitted: RetroAchievements carries its API key there.
        decky.logger.warning(
            "%s %s%s -> HTTP %s %s (request id %s): %s",
            method,
            parts.netloc,
            parts.path,
            error.code,
            error.reason,
            _request_id(error.headers),
            _body_excerpt(raw),
        )
        return HttpJsonResponse(
            error.code, _decode_json(raw), _retry_after_seconds(error.headers)
        )
    except OSError as error:
        decky.logger.error(
            "%s %s%s failed: %r", method, parts.netloc, parts.path, error
        )
        return None


def request_json(
    url: str,
    *,
    method: str = "GET",
    body: object = None,
    form: dict[str, str] | None = None,
    bearer_token: str | None = None,
) -> object:
    """Perform a blocking HTTP request and decode its JSON response; None on failure."""
    result = request_json_status(
        url,
        method=method,
        body=body,
        form=form,
        bearer_token=bearer_token,
    )
    if result is None or result.status >= 400:
        return None
    return result.body
