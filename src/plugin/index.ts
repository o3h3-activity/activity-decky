import { gameAnatomyHandshake } from "@api/discIdentity";
import { getIsDebugEnabled } from "@api/settings";
import type { Events } from "@events";
import { registerPages } from "@pages";
import { Steam } from "@steam";
import { LifetimeScope } from "@steam/lifetimeScope";
import { mountActivityAccount } from "@stores/account";
import { discDetectionStore } from "@stores/discDetection";
import { injectTailwind } from "@ui/tailwind";
import { showErrorToast } from "@ui/toasts";
import logger, { setDebugEnabled } from "@utils/logger";
import type { Emitter } from "nanoevents";

const DISC_DETECTION_UNAVAILABLE =
	"Disc game detection is unavailable, so RetroAchievements for PS1, PS2 and PSP disc images won't load.";

/** Owns plugin-wide startup and cleanup, independently of Steam login sessions. */
export class Plugin {
	private readonly scope = new LifetimeScope("Plugin");
	private readonly steam: Steam;

	constructor(eventBus: Emitter<Events>) {
		this.scope.addDisposer(() => {
			logger.once.clear();
		});

		this.steam = this.scope.track(new Steam(eventBus));
	}

	mount(): void {
		void this.loadDebugSetting();
		mountActivityAccount(this.scope);
		void this.connectGameAnatomy();

		this.steam.mount();
		injectTailwind(this.scope);
		registerPages(this.scope);
	}

	unMount(): void {
		this.scope.unMount();
	}

	private async loadDebugSetting(): Promise<void> {
		try {
			const persisted = await getIsDebugEnabled();

			if (persisted !== null) {
				setDebugEnabled(persisted);
			}
		} catch (error: unknown) {
			logger.error("[activity] Failed to load `isDebugEnabled` setting", error);
		}
	}

	private async connectGameAnatomy(): Promise<void> {
		let connected = false;

		try {
			connected = await gameAnatomyHandshake();
		} catch (error: unknown) {
			if (!this.scope.signal.aborted) {
				logger.error("[activity] game-anatomy startup check failed", error);
			}
		}

		if (this.scope.signal.aborted) {
			return;
		}

		if (connected) {
			discDetectionStore.status.set("available");
		} else {
			discDetectionStore.status.set("unavailable");
		}

		if (connected) {
			logger.info("[activity] game-anatomy connected");
		} else {
			showErrorToast(DISC_DETECTION_UNAVAILABLE);
		}
	}
}
