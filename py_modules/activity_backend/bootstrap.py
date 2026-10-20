"""Composition root: the only place coupling capabilities to concrete adapters."""

from dataclasses import dataclass
from logging import Logger
from pathlib import Path

from activity_backend.infrastructure.activity_transport import ActivityApiClient
from activity_backend.infrastructure.settings import SETTINGS_FILE_NAME, SettingsStore
from activity_backend.modules.achievements.adapters.http import RetroAchievementsHttpApi
from activity_backend.modules.achievements.api import RetroAchievementsClient
from activity_backend.modules.activity.adapters.activity_api import ActivityApiEndpoint
from activity_backend.modules.activity.adapters.playtime_totals import (
    SettingsPlaytimeTotals,
)
from activity_backend.modules.activity.api import ActivityProxy
from activity_backend.modules.authorization.adapters.decky_emitter import (
    DeckyAuthorizationEmitter,
)
from activity_backend.modules.authorization.adapters.device_endpoint import (
    ActivityDeviceAuthorizationEndpoint,
)
from activity_backend.modules.authorization.adapters.token_store import (
    SettingsTokenStore,
)
from activity_backend.modules.authorization.api import DeviceAuthorizationClient
from activity_backend.modules.catalog.adapters.activity_api import (
    ActivityCatalogEndpoint,
    SettingsRecognitionCache,
)
from activity_backend.modules.catalog.api import GameRecognitionClient
from activity_backend.modules.identity.adapters.native import (
    GameAnatomyNativeOperations,
)
from activity_backend.modules.identity.api import GameIdentityBatch


@dataclass(frozen=True, slots=True)
class Backend:
    """Wired capabilities sharing one identity cache and authorization lifecycle."""

    settings: SettingsStore
    identities: GameIdentityBatch
    authorization: DeviceAuthorizationClient
    catalog: GameRecognitionClient
    activity: ActivityProxy
    achievements: RetroAchievementsClient


def build_backend(
    settings_directory: Path,
    home: Path,
    plugin_directory: Path,
    logger: Logger,
) -> Backend:
    """Construct explicit dependencies from the runtime's paths and logger."""
    settings = SettingsStore(settings_directory / SETTINGS_FILE_NAME)
    transport = ActivityApiClient()
    identities = GameIdentityBatch(
        home, GameAnatomyNativeOperations(plugin_directory), logger
    )
    authorization = DeviceAuthorizationClient(
        SettingsTokenStore(settings),
        ActivityDeviceAuthorizationEndpoint(transport),
        logger,
        DeckyAuthorizationEmitter().emit,
    )
    return Backend(
        settings=settings,
        identities=identities,
        authorization=authorization,
        catalog=GameRecognitionClient(
            SettingsRecognitionCache(settings),
            ActivityCatalogEndpoint(transport),
            authorization,
            logger,
        ),
        activity=ActivityProxy(
            ActivityApiEndpoint(transport),
            authorization,
            logger,
            SettingsPlaytimeTotals(settings),
            authorization.get_user,
        ),
        achievements=RetroAchievementsClient(
            authorization,
            RetroAchievementsHttpApi(),
            identities,
            logger,
        ),
    )
