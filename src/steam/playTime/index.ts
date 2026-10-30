import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import { accountStore } from "@stores/account";
import { isPlayTimeSharingActive } from "@stores/playTimeSync";
import logger from "@utils/logger";
import { parsePlayTimeInterval } from "./event";
import { canSharePlayTime } from "./policy";
import { PlayTimeQueue } from "./queue";
import { PlayTimeSync } from "./sync";

/** Dispatched on `window` by the PlayTime Decky plugin for each finished play interval. */
const PLAYTIME_INTERVAL_EVENT = "playtime:interval-committed:v1";

/** Collects locally supported PlayTime intervals and replays them for one Steam login. */
export class PlayTime {
	private readonly scope = new LifetimeScope("PlayTime");
	private collectionGeneration = 0;
	private mounted = false;
	private readonly queue: PlayTimeQueue;
	private readonly sync: PlayTimeSync;

	private readonly onInterval = (event: Event): void => {
		void this.handle(event);
	};

	/** Invalidates in-flight collection only after collection becomes forbidden. */
	private readonly onPolicyChanged = (): void => {
		if (!this.canCollect()) {
			this.collectionGeneration += 1;
		}
	};

	constructor(
		private readonly steamId: string,
		private readonly games: Games,
	) {
		this.queue = new PlayTimeQueue(steamId);
		this.sync = this.scope.track(new PlayTimeSync(this.queue, games, steamId));
	}

	mount(): void {
		if (this.scope.signal.aborted || this.mounted) {
			return;
		}

		this.mounted = true;
		const target = window;

		target.addEventListener(PLAYTIME_INTERVAL_EVENT, this.onInterval);

		this.scope.addDisposer(() => {
			target.removeEventListener(PLAYTIME_INTERVAL_EVENT, this.onInterval);
		});

		this.scope.addDisposer(
			isPlayTimeSharingActive.onChange(this.onPolicyChanged),
		);

		this.scope.addDisposer(
			accountStore.authorization.onChange(this.onPolicyChanged),
		);

		this.scope.addDisposer(accountStore.profile.onChange(this.onPolicyChanged));

		this.sync.mount();
	}

	unMount(): void {
		this.scope.unMount();
	}

	private canCollect(): boolean {
		return !this.scope.signal.aborted && canSharePlayTime(this.steamId);
	}

	private isCurrent(generation: number): boolean {
		return this.collectionGeneration === generation && this.canCollect();
	}

	private async handle(event: Event): Promise<void> {
		const interval = parsePlayTimeInterval(event);

		if (!interval || !this.canCollect()) {
			return;
		}

		const generation = this.collectionGeneration;

		try {
			const game = await this.games.get(interval.appId);

			if (!this.isCurrent(generation) || !game?.disc) {
				return;
			}

			const added = await this.queue.add(
				interval.appId,
				interval.startedAt,
				interval.endedAt,
			);

			if (added && this.isCurrent(generation)) {
				this.sync.requestFlush();
			}
		} catch (error: unknown) {
			if (this.isCurrent(generation)) {
				logger.error("[PlayTime] Failed to collect interval", error);
			}
		}
	}
}
