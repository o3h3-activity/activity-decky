import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import { App } from "@steam/proxy/app";
import { accountStore } from "@stores/account";
import { isPlayTimeSharingActive } from "@stores/playTimeSync";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";
import { parsePlayTimeInterval } from "./event";
import { canSharePlayTime } from "./policy";
import { PlayTimeQueue } from "./queue";
import { PlayTimeSync } from "./sync";

/** Dispatched on `window` by the PlayTime Decky plugin for each finished play interval. */
const PLAYTIME_INTERVAL_EVENT = "playtime:interval-committed:v1";

/** Per-login collaborators; absent when Steam exposes no current user. */
interface PlayTimeAccount {
	readonly queue: PlayTimeQueue;
	readonly steamId: string;
	readonly sync: PlayTimeSync;
}

/** Collects locally supported PlayTime intervals and replays them for the current Steam login. */
export class PlayTime {
	private readonly scope = new LifetimeScope("PlayTime");
	private readonly account: PlayTimeAccount | undefined;
	private collectionGeneration = 0;
	private mounted = false;

	private readonly onInterval = (event: Event): void => {
		void this.handle(event);
	};

	/** Invalidates in-flight collection only after collection becomes forbidden. */
	private readonly onPolicyChanged = (): void => {
		if (!this.canCollect()) {
			this.collectionGeneration += 1;
		}
	};

	constructor(private readonly games: Games) {
		const steamId = App.getCurrentUserIdAsU64();

		if (!steamId) {
			this.account = undefined;

			return;
		}

		const queue = new PlayTimeQueue(steamId);
		const sync = this.scope.track(new PlayTimeSync(queue, games, steamId));

		this.account = { queue, steamId, sync };
	}

	mount(): void {
		if (isNil(this.account) || this.scope.signal.aborted || this.mounted) {
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

		this.account.sync.mount();
	}

	unMount(): void {
		this.scope.unMount();
	}

	private canCollect(): boolean {
		return (
			!this.scope.signal.aborted &&
			!isNil(this.account) &&
			canSharePlayTime(this.account.steamId)
		);
	}

	private isCurrent(generation: number): boolean {
		return this.collectionGeneration === generation && this.canCollect();
	}

	private async handle(event: Event): Promise<void> {
		const { account } = this;
		const interval = parsePlayTimeInterval(event);

		if (isNil(account) || !interval || !this.canCollect()) {
			return;
		}

		const generation = this.collectionGeneration;

		try {
			const game = await this.games.get(interval.appId);

			if (!this.isCurrent(generation) || !game?.disc) {
				return;
			}

			const added = await account.queue.add(
				interval.appId,
				interval.startedAt,
				interval.endedAt,
			);

			if (added && this.isCurrent(generation)) {
				account.sync.requestFlush();
			}
		} catch (error: unknown) {
			if (this.isCurrent(generation)) {
				logger.error("[PlayTime] Failed to collect interval", error);
			}
		}
	}
}
