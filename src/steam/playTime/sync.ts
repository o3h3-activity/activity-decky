import type { PendingPlaytime } from "@api/activity";
import type { ApiFailure, ApiResult } from "@api/rpc/result";
import type { Games } from "@steam/games";
import { hasActivityIdentifiers } from "@steam/games/game";
import { LifetimeScope } from "@steam/lifetimeScope";
import { Network } from "@steam/proxy/network";
import { accountStore } from "@stores/account";
import { isPlayTimeSharingActive } from "@stores/playTimeSync";
import logger from "@utils/logger";
import { canSharePlayTime } from "./policy";
import type { ActivityIdentifiers, PlayTimeQueue } from "./queue";
import { RetryTimer } from "./retryTimer";

const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;

/** A request-specific 4xx leaves later intervals eligible for this pass. */
function affectsOnlyThisInterval({ error, status }: ApiFailure): boolean {
	return (
		error === "invalidRequest" ||
		(error === "httpError" &&
			status >= HTTP_CLIENT_ERROR_MIN &&
			status < HTTP_SERVER_ERROR_MIN &&
			status !== HTTP_REQUEST_TIMEOUT &&
			status !== HTTP_TOO_MANY_REQUESTS)
	);
}

/** One queue entry's delivery result. */
type Delivery = "aborted" | "deferred" | "failed" | "held" | "settled";

/** Sends one Steam account's durable outbox serially while collection is permitted. */
export class PlayTimeSync {
	private readonly scope = new LifetimeScope("PlayTimeSync");
	private readonly retryTimer = new RetryTimer();
	private flushing = false;
	private flushRequested = false;
	private generation = 0;
	private mounted = false;

	constructor(
		private readonly queue: PlayTimeQueue,
		private readonly games: Games,
		private readonly steamId: string,
	) {}

	readonly requestFlush = (): void => {
		if (!this.canSync()) {
			return;
		}

		this.flushRequested = true;

		if (!this.flushing) {
			this.flushing = true;
			void this.flush();
		}
	};

	/** A changed account may resolve an account-mismatch hold even if it remains signed in. */
	private readonly onStateChanged = (): void => {
		this.generation += 1;

		if (this.canSync()) {
			this.requestFlush();
		} else {
			this.retryTimer.cancel();
		}
	};

	/** A fresh connection makes the old delay irrelevant. */
	private readonly onReconnected = (): void => {
		this.retryTimer.reset();
		this.requestFlush();
	};

	mount(): void {
		if (this.scope.signal.aborted || this.mounted) {
			return;
		}

		this.mounted = true;
		this.scope.addDisposer(() => {
			this.retryTimer.cancel();
		});

		this.scope.addDisposer(
			isPlayTimeSharingActive.onChange(this.onStateChanged),
		);

		this.scope.addDisposer(
			accountStore.authorization.onChange(this.onStateChanged),
		);

		this.scope.addDisposer(accountStore.profile.onChange(this.onStateChanged));
		this.scope.addDisposer(Network.onReconnected(this.onReconnected));
		this.requestFlush();
	}

	unMount(): void {
		this.scope.unMount();
	}

	private canSync(): boolean {
		return !this.scope.signal.aborted && canSharePlayTime(this.steamId);
	}

	private isCurrent(generation: number): boolean {
		return generation === this.generation && this.canSync();
	}

	/** Runs one serial drain, preserving requests raised by commits during an in-flight upload. */
	private async flush(): Promise<void> {
		if (!this.canSync()) {
			this.flushing = false;

			return;
		}

		if (Network.isOnline() === false) {
			this.flushRequested = false;
			this.flushing = false;
			this.scheduleRetry();

			return;
		}

		this.retryTimer.cancel();
		let settled = false;

		try {
			settled = await this.drain();
		} catch (error: unknown) {
			if (this.canSync()) {
				logger.error("[PlayTime] Failed to read pending intervals", error);
			}
		} finally {
			this.flushing = false;
		}

		if (!this.canSync()) {
			return;
		}

		if (this.flushRequested) {
			this.requestFlush();
		} else if (settled) {
			this.retryTimer.reset();
		} else {
			this.scheduleRetry();
		}
	}

	private scheduleRetry(): void {
		if (this.canSync()) {
			this.retryTimer.schedule(this.requestFlush);
		}
	}

	/** Resolves whether all intervals in the last snapshot were settled. */
	private async drain(): Promise<boolean> {
		let settled = true;

		while (this.flushRequested && this.canSync()) {
			this.flushRequested = false;
			const generation = this.generation;
			const intervals = await this.queue.pending();

			if (!this.isCurrent(generation)) {
				return false;
			}

			settled = true;

			for (const interval of intervals) {
				const delivery = await this.deliver(interval, generation);

				if (delivery === "held") {
					return true;
				}

				if (delivery === "aborted" || delivery === "failed") {
					return false;
				}

				if (delivery === "deferred") {
					settled = false;
				}
			}
		}

		return settled;
	}

	private async deliver(
		interval: PendingPlaytime,
		generation: number,
	): Promise<Delivery> {
		if (!this.isCurrent(generation)) {
			return "aborted";
		}

		let identifiers: ActivityIdentifiers | undefined;

		try {
			identifiers = await this.identifiers(interval);
		} catch (error: unknown) {
			if (this.isCurrent(generation)) {
				logger.error(
					"[PlayTime] Failed to resolve interval identifiers",
					error,
				);
			}

			return this.isCurrent(generation) ? "deferred" : "aborted";
		}

		if (!this.isCurrent(generation)) {
			return "aborted";
		}

		if (!identifiers) {
			return "deferred";
		}

		return this.upload(interval, identifiers, generation);
	}

	private async upload(
		interval: PendingPlaytime,
		identifiers: ActivityIdentifiers,
		generation: number,
	): Promise<Delivery> {
		let result: ApiResult;

		try {
			result = await this.queue.upload(interval, identifiers);
		} catch (error: unknown) {
			if (this.isCurrent(generation)) {
				logger.error("[PlayTime] Failed to record interval", error);
			}

			return this.isCurrent(generation) ? "failed" : "aborted";
		}

		if (!this.isCurrent(generation)) {
			return "aborted";
		}

		if (result.ok || result.error === "deliveryUnknown") {
			return "settled";
		}

		logger.error("[PlayTime] Failed to record interval", result);

		if (result.error === "accountMismatch") {
			return "held";
		}

		return affectsOnlyThisInterval(result) ? "deferred" : "failed";
	}

	/** Pinned bindings survive a shortcut that is no longer available for recognition. */
	private async identifiers(
		interval: PendingPlaytime,
	): Promise<ActivityIdentifiers | undefined> {
		if (interval.gameId && interval.releaseId && interval.releaseRevisionId) {
			return {
				gameId: interval.gameId,
				releaseId: interval.releaseId,
				releaseRevisionId: interval.releaseRevisionId,
			};
		}

		const release = await this.games.getRelease(interval.appId);

		return hasActivityIdentifiers(release)
			? {
					gameId: release.gameId,
					releaseId: release.releaseId,
					releaseRevisionId: release.revisionId,
				}
			: undefined;
	}
}
