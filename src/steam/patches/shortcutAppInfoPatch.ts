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
 * Prevents native Steam app-info requests for supported local shortcuts.
 *
 * Shortcut app ids identify local library entries rather than Steam catalog
 * apps. Native UI paths can still request app info for these entries; this
 * patch prevents those requests from entering Steam's metadata queue.
 *
 * Only `AppInfoStore.QueueAppInfoRequest` is intercepted. For a shortcut
 * currently supported by Games, it returns a resolved promise without
 * enqueueing work. Unsupported shortcuts and non-shortcut apps use the original
 * implementation. Support is checked per request rather than at installation,
 * allowing eligibility to follow Games' current state. This patch does not
 * supply replacement app info or change cached metadata.
 *
 * SessionPatches owns the patch independently of other UI patches. Installation
 * waits for appDetailsStore readiness, then discovers AppInfoStore by its method
 * shape. If readiness times out or discovery fails, requests remain unpatched.
 * The session-owned LifetimeScope cancels pending installation on logout and
 * removes the interception if it was installed.
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
