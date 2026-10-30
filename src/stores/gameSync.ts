import type { LifetimeScope } from "@steam/lifetimeScope";
import { isNil } from "es-toolkit";

/** Where a sync stands; once `sent` reaches `total`, games Activity did not answer are asked about again on their page. */
export type GameSyncProgress = Readonly<{
	/** Sent games Activity answered for. */
	answered: number;
	/** Batches sent so far, out of `batches`. */
	batch: number;
	batches: number;
	/** Games sent so far, out of `total` identified games. */
	sent: number;
	total: number;
}>;

export type GameSyncListener = (progress: GameSyncProgress) => void;

type GameSync = (onProgress: GameSyncListener) => Promise<GameSyncProgress>;

/** Only the current Steam session's games can be synced; set while that session is mounted. */
let current: GameSync | undefined;

/** Lets the UI sync `scope`'s games until the scope ends. */
export function provideGameSync(scope: LifetimeScope, sync: GameSync): void {
	current = sync;

	scope.addDisposer(() => {
		if (current === sync) {
			current = undefined;
		}
	});
}

/**
 * Resolves the final progress. `onProgress` hears the total once the games are found, then each sent batch.
 * Rejects outside a Steam session, when shortcut discovery is incomplete, a batch fails, or the session ends.
 */
export async function syncGames(
	onProgress: GameSyncListener,
): Promise<GameSyncProgress> {
	if (isNil(current)) {
		throw new Error("No Steam session to sync games from");
	}

	return current(onProgress);
}
