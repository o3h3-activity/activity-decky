import {
	getIsPlayTimeSyncEnabled,
	setIsPlayTimeSyncEnabled,
} from "@api/settings";
import { observable } from "@legendapp/state";
import type { LifetimeScope } from "@steam/lifetimeScope";
import { accountStore } from "@stores/account";
import logger from "@utils/logger";

type PlayTimeSyncStore = {
	/** Whether finished PlayTime sessions are sent to Activity; undefined until the saved choice loads. */
	isEnabled: boolean | undefined;
};

/** Plugin-wide PlayTime sharing choice; only this module writes it. */
export const playTimeSyncStore = observable<PlayTimeSyncStore>({
	isEnabled: undefined,
});

/** Whether PlayTime intervals may be collected and uploaded: signed in and opted in. */
export const isPlayTimeSharingActive = observable(
	() =>
		accountStore.authorization.status.get() === "signedIn" &&
		playTimeSyncStore.isEnabled.get() === true,
);

/** Bumped by each saved choice and by unmount, so a slower load never overwrites them. */
let generation = 0;

/** Loads the saved choice once for the plugin's lifetime; a failed load leaves sharing off. */
export function mountPlayTimeSync(scope: LifetimeScope): void {
	const loadGeneration = generation;

	scope.addDisposer(() => {
		generation += 1;
		playTimeSyncStore.isEnabled.set(undefined);
	});

	void (async () => {
		let isEnabled = false;

		try {
			isEnabled = await getIsPlayTimeSyncEnabled();
		} catch (error: unknown) {
			logger.error("[activity] Could not load the PlayTime setting", error);
		}

		if (loadGeneration === generation) {
			playTimeSyncStore.isEnabled.set(isEnabled);
		}
	})();
}

/** Requires a signed-in Activity account; persists the choice before publishing it. */
export async function savePlayTimeSync(isEnabled: boolean): Promise<void> {
	if (accountStore.authorization.peek()?.status !== "signedIn") {
		throw new Error(
			"Sign in to Activity before changing PlayTime integration.",
		);
	}

	await setIsPlayTimeSyncEnabled(isEnabled);

	generation += 1;
	playTimeSyncStore.isEnabled.set(isEnabled);
}
