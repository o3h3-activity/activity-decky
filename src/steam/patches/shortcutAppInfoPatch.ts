import { callOriginal, replacePatch } from "@decky/ui";
import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import { AppInfoStore } from "@steam/proxy/appInfoStore";
import {
	DEPENDENCY_POLL_INTERVAL_MS,
	DEPENDENCY_READY_TIMEOUT_MS,
	waitForDependency,
} from "@steam/waitForDependency";
import logger from "@utils/logger";
import { isSupportedShortcut } from "./shortcutEligibility";

/**
 * Keeps supported shortcut IDs out of Steam's app-info request queue.
 *
 * For an unknown appid, `GetAppInfo` creates a cache entry and calls
 * `QueueAppInfoRequest`. Steam batches these IDs after 25 ms and sends them
 * to `CommunityService.GetApps`. Local shortcut IDs have no Steam catalog
 * entry, so we skip the queue step and return a resolved promise instead.
 * The cache entry may still be created; this does not fill it or mark it valid.
 *
 * Support is checked on each request. Other apps and unsupported shortcuts
 * still use Steam's queue. Installation waits for `appDetailsStore`, then
 * locates AppInfoStore by its methods. If either is unavailable, requests
 * remain unchanged. This patch does not depend on `OverviewPatch`.
 */
export class ShortcutAppInfoPatch {
	private readonly scope = new LifetimeScope("ShortcutAppInfo");

	constructor(private readonly games: Games) {
		this.scope.installGuarded(
			() => this.installPatches(),
			"[ShortcutAppInfo] Failed to install patch",
		);
	}

	unMount(): void {
		this.scope.unMount();
	}

	private async installPatches(): Promise<void> {
		const store = await waitForDependency(
			this.scope,
			() => window.appDetailsStore,
			DEPENDENCY_POLL_INTERVAL_MS,
			DEPENDENCY_READY_TIMEOUT_MS,
		);

		if (!store) {
			logger.error(
				"[ShortcutAppInfo] `window.appDetailsStore` never appeared. Patch NOT installed.",
			);

			this.unMount();

			return;
		}

		const appInfoStore = AppInfoStore.getAppInfoStore();

		if (!appInfoStore) {
			logger.error(
				"[ShortcutAppInfo] AppInfoStore not found. Shortcut app info requests unpatched.",
			);

			return;
		}

		this.scope.add(
			replacePatch(appInfoStore, "QueueAppInfoRequest", (args) => {
				const appId = args[0] as number;

				if (!isSupportedShortcut(this.games, appId)) {
					return callOriginal;
				}

				return Promise.resolve();
			}),
		);
	}
}
