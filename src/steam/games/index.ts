import {
	RECOGNITION_BATCH_SIZE,
	recognizeGameBatch,
	recognizeGames,
} from "@api/catalog";
import { LifetimeScope } from "@steam/lifetimeScope";
import type { SessionResource } from "@steam/sessionLifecycle";
import type { GameSyncListener, GameSyncProgress } from "@stores/gameSync";
import logger from "@utils/logger";
import { chunk, isNil } from "es-toolkit";
import { Game, type GameRelease } from "./game";
import { Identity } from "./identity";

/**
 * Only definitive answers are kept: a shortcut Steam or the backend failed to answer for is asked
 * about again at its next lookup, and so is a disc Activity's catalog could not answer for yet.
 * Edited shortcuts keep their first answer until the next login. Lookups never reject.
 */
export class Games implements SessionResource {
	private readonly scope = new LifetimeScope("Games");
	private readonly games = new Map<number, Game>();
	private readonly nonGames = new Set<number>();
	private readonly loading = new Map<number, Promise<void>>();
	private queuedBatch: undefined | { appIds: number[]; promise: Promise<void> };
	private syncing: Promise<GameSyncProgress> | undefined;
	private syncProgress: GameSyncProgress | undefined;
	private readonly syncListeners = new Set<GameSyncListener>();

	constructor(private readonly identity: Identity = new Identity()) {
		this.scope.addDisposer(() => {
			this.games.clear();
			this.nonGames.clear();
			this.loading.clear();
		});
	}

	async mount(): Promise<void> {
		const appIds = this.identity.shortcutAppIds();

		if (isNil(appIds)) {
			logger.error(
				"[Games] `appStore` unavailable; shortcuts load at first lookup",
			);

			return;
		}

		await this.load(appIds);

		logger.debug(
			`[Games] Loaded ${this.games.size} games from ${appIds.length} shortcuts`,
		);
	}

	/** Only backend-confirmed app IDs are eligible; unknown shortcuts stay untouched while loading. */
	isSupported(appId: number): boolean {
		const game = this.games.get(appId);

		if (isNil(game)) {
			void this.load([appId]);
		}

		return !isNil(game?.disc);
	}

	async get(appId: number): Promise<Game | undefined> {
		await this.load([appId]);

		return this.games.get(appId);
	}

	async getRelease(appId: number): Promise<GameRelease | undefined> {
		const game = await this.get(appId);

		if (isNil(game) || !game.awaitsRecognition) {
			return game?.release;
		}

		const recognised = await this.recognise(game);

		return recognised.release;
	}

	/**
	 * Asks Activity about every identified game on this device, `RECOGNITION_BATCH_SIZE` per request,
	 * once shortcut discovery finishes. `onProgress` hears the total first, then each sent batch.
	 * Overlapping calls share one sync, and a late caller first hears its latest progress. Rejects when
	 * Steam's shortcut list is unavailable, discovery is incomplete, a batch fails, or the session ends;
	 * answers from successfully discovered games are kept.
	 */
	async sync(onProgress?: GameSyncListener): Promise<GameSyncProgress> {
		if (!isNil(onProgress)) {
			this.syncListeners.add(onProgress);

			if (!isNil(this.syncProgress)) {
				onProgress(this.syncProgress);
			}
		}

		this.syncing ??= this.syncAll().finally(() => {
			this.syncing = undefined;
			this.syncProgress = undefined;
			this.syncListeners.clear();
		});

		return this.syncing;
	}

	unMount(): void {
		this.scope.unMount();
	}

	/** Coalesces same-turn lookups, joining loads already in flight. */
	private async load(appIds: readonly number[]): Promise<void> {
		if (this.scope.signal.aborted) {
			return;
		}

		const unknown = appIds.filter((appId) => !this.isKnown(appId));

		if (unknown.length > 0) {
			this.enqueue(unknown);
		}

		await Promise.all(appIds.map(async (appId) => this.loading.get(appId)));
	}

	private enqueue(appIds: readonly number[]): void {
		if (isNil(this.queuedBatch)) {
			const queued: number[] = [];
			const promise = Promise.resolve()
				.then(() => {
					this.queuedBatch = undefined;

					return this.scope.signal.aborted ? undefined : this.loadBatch(queued);
				})
				.finally(() => {
					for (const appId of queued) {
						this.loading.delete(appId);
					}
				});

			this.queuedBatch = { appIds: queued, promise };
		}

		for (const appId of appIds) {
			this.queuedBatch.appIds.push(appId);
			this.loading.set(appId, this.queuedBatch.promise);
		}
	}

	private isKnown(appId: number): boolean {
		return (
			this.games.has(appId) ||
			this.nonGames.has(appId) ||
			this.loading.has(appId)
		);
	}

	private async loadBatch(appIds: readonly number[]): Promise<void> {
		const located = await Promise.all(
			appIds.map(async (appId) => this.locate(appId)),
		);
		const games = located.filter((game): game is Game => !isNil(game));

		if (games.length === 0 || this.scope.signal.aborted) {
			return;
		}

		try {
			const identified = await this.identity.identify(games);

			if (this.scope.signal.aborted) {
				return;
			}

			for (const game of identified) {
				this.games.set(game.appId, game);
			}
		} catch (error: unknown) {
			logger.error("[Games] Failed to identify games", error);
		}
	}

	private async syncAll(): Promise<GameSyncProgress> {
		const appIds = this.identity.shortcutAppIds();

		if (isNil(appIds)) {
			throw new Error("Steam's shortcut list is unavailable");
		}

		await this.load(appIds);
		this.scope.signal.throwIfAborted();

		const hasDiscoveryFailures = appIds.some(
			(appId) => !this.games.has(appId) && !this.nonGames.has(appId),
		);

		const identified = [...this.games.values()].filter(
			(game) => !isNil(game.disc),
		);
		const batches = chunk(identified, RECOGNITION_BATCH_SIZE);
		let progress: GameSyncProgress = {
			answered: 0,
			batch: 0,
			batches: batches.length,
			sent: 0,
			total: identified.length,
		};

		this.reportSync(progress);

		for (const batch of batches) {
			const answers = await recognizeGameBatch(
				batch.flatMap((game) => game.disc?.toResult(game.appId) ?? []),
			);

			this.scope.signal.throwIfAborted();

			let { answered } = progress;

			for (const game of batch) {
				const answeredGame = game.answeredBy(answers);

				if (answeredGame !== game) {
					answered += 1;
					this.games.set(game.appId, answeredGame);
				}
			}

			progress = {
				...progress,
				answered,
				batch: progress.batch + 1,
				sent: progress.sent + batch.length,
			};

			this.reportSync(progress);
		}

		if (hasDiscoveryFailures) {
			throw new Error("Could not discover every Steam shortcut");
		}

		return progress;
	}

	private reportSync(progress: GameSyncProgress): void {
		this.syncProgress = progress;

		for (const listener of this.syncListeners) {
			listener(progress);
		}
	}

	private async locate(appId: number): Promise<Game | undefined> {
		try {
			const romPath = await this.identity.locate(appId);

			if (!isNil(romPath)) {
				return Game.launching(appId, romPath);
			}

			if (!this.scope.signal.aborted) {
				this.nonGames.add(appId);
			}

			return undefined;
		} catch (error: unknown) {
			logger.error(`[Games] Failed to read shortcut ${appId}`, error);

			return undefined;
		}
	}

	private async recognise(game: Game): Promise<Game> {
		const { disc } = game;

		if (isNil(disc)) {
			return game;
		}

		try {
			const answers = await recognizeGames([disc.toResult(game.appId)]);

			if (this.scope.signal.aborted) {
				return game;
			}

			const answered = game.answeredBy(answers);

			this.games.set(game.appId, answered);

			return answered;
		} catch (error: unknown) {
			logger.error(`[Games] Failed to recognise shortcut ${game.appId}`, error);

			return game;
		}
	}
}
