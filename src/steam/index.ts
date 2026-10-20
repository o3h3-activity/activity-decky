import type { Events } from "@events";
import type { Emitter } from "nanoevents";
import { PlayTime } from "../plugin/playTime";
import { Games } from "./games";
import { LifetimeScope } from "./lifetimeScope";
import { MiddlewareManager } from "./middleware";
import { SessionPatches } from "./patches";
import { SessionLifecycle } from "./sessionLifecycle";
import { UserStateManager } from "./userStateManager";

export class Steam {
	private middlewareManager: MiddlewareManager;
	private userStateManager: UserStateManager;

	private readonly session = new SessionLifecycle(() => {
		const scope = new LifetimeScope("SteamSession");
		const games = scope.track(new Games());
		const playTime = scope.track(new PlayTime(games));
		const patches = scope.track(new SessionPatches(games));

		return {
			async mount(): Promise<void> {
				playTime.mount();
				await games.mount();

				if (!scope.signal.aborted) {
					await patches.mount();
				}
			},
			unMount(): void {
				scope.unMount();
			},
		};
	});

	constructor(eventBus: Emitter<Events>) {
		this.userStateManager = new UserStateManager(eventBus);

		this.middlewareManager = new MiddlewareManager(eventBus);
	}

	mount(): void {
		this.session.mount();
	}

	unMount(): void {
		this.middlewareManager.unMount();
		this.userStateManager.unMount();
		this.session.unMount();
	}
}
