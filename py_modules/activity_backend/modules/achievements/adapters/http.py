"""RetroAchievements HTTP adapter."""

from typing import cast
from urllib.parse import urlencode

from activity_backend.infrastructure.http_client import request_json
from activity_backend.modules.authorization.api import RetroAchievementsCredentials

RA_CONNECT_URL = "https://retroachievements.org/dorequest.php"
RA_PROGRESS_URL = "https://retroachievements.org/API/API_GetGameInfoAndUserProgress.php"


class RetroAchievementsHttpApi:
    """Translate RetroAchievements protocol requests into JSON HTTP calls."""

    def lookup_game_id(self, md5: str) -> int | None:
        """Look up a RetroAchievements game id from a ROM identity hash."""
        payload = request_json(
            RA_CONNECT_URL,
            method="POST",
            form={"r": "gameid", "m": md5},
        )
        if not isinstance(payload, dict):
            return None
        response = cast(dict[object, object], payload)
        if response.get("Success") is not True:
            return None
        game_id = response.get("GameID")
        return game_id if type(game_id) is int else None

    def get_progress(
        self, credentials: RetroAchievementsCredentials, game_id: int
    ) -> object:
        """Fetch one user's progress using RetroAchievements' query-string API."""
        query = urlencode(
            {
                "z": credentials.username,
                "y": credentials.api_key,
                "u": credentials.username,
                "g": game_id,
            }
        )
        return request_json(f"{RA_PROGRESS_URL}?{query}")
