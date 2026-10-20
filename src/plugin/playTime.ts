import { recordPlaytime } from "@api/activity";
import type { Games } from "@steam/games";
import { hasActivityIdentifiers } from "@steam/games/game";
import { LifetimeScope } from "@steam/lifetimeScope";
import logger from "@utils/logger";

const PLAYTIME_INTERVAL_EVENT = "playtime:interval-committed:v1";

type PlayTimeInterval = {
	endedAt: number;
	game: { id: number | string; name: string };
	startedAt: number;
};

/** Syncs recognised shortcuts for one Steam login; logout cancels pending lookups. */
export class PlayTime {
	private readonly scope = new LifetimeScope("PlayTime");

	private readonly onInterval = (event: Event): void => {
		void this.handle(event);
	};

	constructor(private readonly games: Games) {}

	mount(): void {
		if (this.scope.signal.aborted) {
			return;
		}

		const target = window;

		target.addEventListener(PLAYTIME_INTERVAL_EVENT, this.onInterval);

		this.scope.addDisposer(() => {
			target.removeEventListener(PLAYTIME_INTERVAL_EVENT, this.onInterval);
		});
	}

	unMount(): void {
		this.scope.unMount();
	}

	private async handle(event: Event): Promise<void> {
		try {
			await this.sync(event);
		} catch (error: unknown) {
			logger.error("[PlayTime] Failed to sync interval", error);
		}
	}

	private async sync(event: Event): Promise<void> {
		const { startedAt, endedAt, game } = (
			event as CustomEvent<PlayTimeInterval>
		).detail;
		const appId = Number(game.id);

		if (!Number.isSafeInteger(appId) || appId <= 0) {
			return;
		}

		const release = await this.games.getRelease(appId);

		if (this.scope.signal.aborted || !hasActivityIdentifiers(release)) {
			return;
		}

		const result = await recordPlaytime(
			release.gameId,
			release.releaseId,
			release.revisionId,
			startedAt,
			endedAt,
		);

		if (!result.ok) {
			logger.error("[PlayTime] Failed to record interval", result);
		}
	}
}
