"""Behavioral coverage for infrastructure."""

import json
import stat
import unittest
from email.message import Message
from io import BytesIO
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError

from backend_support import BackendTestCase, decky

from activity_backend.infrastructure import http_client
from activity_backend.shared import HttpJsonResponse


class SettingsStoreTests(BackendTestCase):
    """Verify typed atomic settings persistence behavior."""

    def test_update_merges_removes_and_enforces_file_mode(self) -> None:
        """Persist merged settings, remove None values, and restrict file permissions."""
        settings = self.settings()
        settings.update({"a": 1, "b": "x"})
        settings.update({"a": None})

        self.assertIsNone(settings.get("a", int))
        self.assertEqual(settings.get("b", str), "x")
        self.assertIsNone(settings.get("b", bool))
        self.assertEqual(stat.S_IMODE(settings.path.stat().st_mode), 0o600)

    def test_update_replaces_invalid_json_root(self) -> None:
        """Discard a non-object JSON root before persisting a new setting."""
        settings = self.settings()
        settings.path.parent.mkdir(parents=True)
        settings.path.write_text("[1]", encoding="utf-8")

        self.assertIsNone(settings.get("missing", str))
        settings.update({"k": True})

        self.assertEqual(
            json.loads(settings.path.read_text(encoding="utf-8")), {"k": True}
        )


class HttpClientTests(unittest.TestCase):
    """Verify HTTP status responses retain defensive rate-limit metadata."""

    def test_http_error_status_exposes_only_valid_retry_after_seconds(self) -> None:
        """Preserve HTTP errors while defaulting absent or malformed retry metadata."""
        for retry_after, expected_seconds in (
            ("20", 20),
            ("0", 0),
            (None, 0),
            ("-1", 0),
            ("1.5", 0),
            ("later", 0),
            (
                str(http_client.MAX_RETRY_AFTER_SECONDS + 1),
                http_client.MAX_RETRY_AFTER_SECONDS,
            ),
            ("9" * 5000, 0),
        ):
            with self.subTest(retry_after=retry_after):
                headers = (
                    {"Retry-After": retry_after} if retry_after is not None else None
                )
                error = HTTPError(
                    "https://example.test",
                    429,
                    "Too Many Requests",
                    headers,
                    BytesIO(b'{"error":"rate_limited"}'),
                )
                with patch.object(http_client, "urlopen", side_effect=error):
                    result = http_client.request_json_status("https://example.test")
                error.close()

                self.assertEqual(
                    result,
                    HttpJsonResponse(429, {"error": "rate_limited"}, expected_seconds),
                )

    def test_http_error_log_explains_failure_without_query_secrets(self) -> None:
        """Log method, route, status, server request id, and body; never the query."""
        error = HTTPError(
            "https://example.test/api/v1/comments?y=secret-key",
            404,
            "Not Found",
            Message(),
            BytesIO(b'{"code":"NOT_FOUND","message":"route not found"}'),
        )
        error.headers["x-request-id"] = "req-123"
        with (
            patch.object(http_client, "urlopen", side_effect=error),
            self.assertLogs(decky.logger, level="WARNING") as logs,
        ):
            http_client.request_json_status(
                "https://example.test/api/v1/comments?y=secret-key", method="POST"
            )
        error.close()

        [line] = logs.output
        self.assertIn("POST example.test/api/v1/comments -> HTTP 404", line)
        self.assertIn("req-123", line)
        self.assertIn('"message":"route not found"', line)
        self.assertNotIn("secret-key", line)

    def test_request_json_forwards_bearer_header(self) -> None:
        """Attach bearer credentials through the convenience JSON wrapper."""
        response = MagicMock()
        response.status = 200
        response.headers = {}
        response.read.return_value = b'{"ok":true}'
        response.__enter__.return_value = response
        response.__exit__.return_value = False
        token = "pat_" + "a" * 64

        with patch.object(http_client, "urlopen", return_value=response) as urlopen:
            result = http_client.request_json(
                "https://example.test/me", bearer_token=token
            )

        self.assertEqual(result, {"ok": True})
        request = urlopen.call_args.args[0]
        self.assertEqual(request.get_header("Authorization"), f"Bearer {token}")
