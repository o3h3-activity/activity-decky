import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import { isPlayTimeSharingActive } from "@stores/playTimeSync";
import logger from "@utils/logger";
import { PlayTimeQueue } from "./queue";
import { PlayTimeSync } from "./sync";

/** Dispatched on `window` by the PlayTime Decky plugin for each finished play interval. */
const PLAYTIME_INTERVAL_EVENT = "playtime:interval-committed:v1";

type PlayTimeInterval = {
	endedAt: number;
	game: { id: number | string; name: string };
	startedAt: number;
};

/** Collects locally supported PlayTime intervals and replays them for one Steam login. */
export class PlayTime {
	private readonly scope = new LifetimeScope("PlayTime");
	private readonly queue: PlayTimeQueue;
	private readonly sync: PlayTimeSync;

	private readonly onInterval = (event: Event): void => {
		void this.handle(event);
	};

	constructor(steamId: string, private readonly games: Games) {
		this.queue = new PlayTimeQueue(steamId);
		this.sync = this.scope.track(new PlayTimeSync(this.queue, games));
	}

	mount(): void {
		if (this.scope.signal.aborted) {
			return;
		}

		const target = window;

		target.addEventListener(PLAYTIME_INTERVAL_EVENT, this.onInterval);

		this.scope.addDisposer(() => {
			target.removeEventListener(PLAYTIME_INTERVAL_EVENT, this.onInterval);
		});

		this.sync.mount();
	}

	unMount(): void {
		this.scope.unMount();
	}

	private async handle(event: Event): Promise<void> {
		if (this.scope.signal.aborted || !isPlayTimeSharingActive.peek()) {
			return;
		}

		try {
			const { startedAt, endedAt, game } = (
				event as CustomEvent<PlayTimeInterval>
			).detail;
			const appId = Number(game.id);

			if (!Number.isSafeInteger(appId) || appId <= 0) {
				return;
			}

			const confirmedGame = await this.games.get(appId);

			if (
				this.scope.signal.aborted ||
				!isPlayTimeSharingActive.peek() ||
				!confirmedGame?.disc
			) {
				return;
			}

			if (await this.queue.add(appId, startedAt, endedAt)) {
				this.sync.requestFlush();
			}
		} catch (error: unknown) {
			logger.error("[PlayTime] Failed to collect interval", error);
		}
	}
}
