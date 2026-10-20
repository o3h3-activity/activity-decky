"""Public RPC envelopes and endpoint result models for activity operations."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict

ApiErrorCode = Literal[
    "invalidRequest",
    "notSignedIn",
    "unreachable",
    "unauthorized",
    "httpError",
    "invalidResponse",
]


class ApiSuccess(TypedDict):
    """Successful Activity RPC result."""

    ok: Literal[True]
    data: object


class ApiFailure(TypedDict):
    """Failed Activity RPC result, with zero for no HTTP status."""

    ok: Literal[False]
    error: ApiErrorCode
    status: int


ApiResult = ApiSuccess | ApiFailure


@dataclass(frozen=True, slots=True)
class EndpointSuccess:
    """Successful endpoint response; an explicit null body is valid for deletion."""

    status: int
    data: object


@dataclass(frozen=True, slots=True)
class EndpointFailure:
    """Classified endpoint failure without a success payload."""

    error: ApiErrorCode
    status: int


EndpointResult = EndpointSuccess | EndpointFailure


def api_success(data: object) -> ApiSuccess:
    """Wrap successful Activity data for Decky RPC callers."""
    return {"ok": True, "data": data}


def api_failure(error: ApiErrorCode, status: int = 0) -> ApiFailure:
    """Wrap a classified failure for Decky RPC callers."""
    return {"ok": False, "error": error, "status": status}


__all__ = [
    "ApiErrorCode",
    "ApiFailure",
    "ApiResult",
    "ApiSuccess",
    "EndpointFailure",
    "EndpointResult",
    "EndpointSuccess",
    "api_failure",
    "api_success",
]
