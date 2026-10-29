import type { PendingPlaytime } from "@api/activity";
import type { ApiFailure } from "@api/rpc/result";
import type { Games } from "@steam/games";
import { hasActivityIdentifiers } from "@steam/games/game";
import { LifetimeScope } from "@steam/lifetimeScope";
import { Network } from "@steam/proxy/network";
import { isPlayTimeSharingActive } from "@stores/playTimeSync";
import logger from "@utils/logger";
import type { ActivityIdentifiers, PlayTimeQueue } from "./queue";
import { RetryTimer } from "./retryTimer";

const HTTP_CLIENT_ERROR_MIN = 400;
const HTTP_SERVER_ERROR_MIN = 500;
const HTTP_REQUEST_TIMEOUT = 408;
const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * Only this interval failed, so later ones may still upload while it stays queued for the next
 * retry: `invalidRequest` means the catalog's identifiers are unusable until recognition changes,
 * and the other 4xx responses concern this request. Anything else (offline, 5xx, 408/429,
 * session loss, sharing disabled) would fail later intervals too: end the pass and back off.
 */
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

/**
 * One interval's outcome. `settled`: uploaded, or refused by Activity and discarded by the
 * backend, so nothing is left to retry. `deferred`: still queued, but later intervals may upload;
 * retry after a delay. `failed`: later intervals would fail too, so back off. `held`: signed in to
 * another Steam account's Activity profile, so the queue waits for its owner, whose sign-in toggles
 * sharing and so requests a flush. `aborted`: sharing stopped mid-pass.
 */
type Delivery = "aborted" | "deferred" | "failed" | "held" | "settled";

/** Sends one queue's intervals serially while sharing is active, retrying until it is empty. */
export class PlayTimeSync {
	private readonly scope = new LifetimeScope("PlayTimeSync");
	private readonly retryTimer = new RetryTimer();
	private flushing = false;
	private flushRequested = false;

	constructor(
		private readonly queue: PlayTimeQueue,
		private readonly games: Games,
	) {}

	readonly requestFlush = (): void => {
		if (!this.canSync()) {
			return;
		}

		this.flushRequested = true;

		if (this.flushing) {
			return;
		}

		this.flushing = true;
		void this.flush();
	};

	/** Earlier failures say nothing about a new connection: retry now and restart the retry delay. */
	private readonly onReconnected = (): void => {
		this.retryTimer.reset();
		this.requestFlush();
	};

	mount(): void {
		if (this.scope.signal.aborted) {
			return;
		}

		this.scope.addDisposer(() => {
			this.retryTimer.cancel();
		});

		this.scope.addDisposer(isPlayTimeSharingActive.onChange(this.requestFlush));
		this.scope.addDisposer(Network.onReconnected(this.onReconnected));
		this.requestFlush();
	}

	unMount(): void {
		this.scope.unMount();
	}

	private canSync(): boolean {
		return !this.scope.signal.aborted && isPlayTimeSharingActive.peek();
	}

	/**
	 * Retries only while intervals stay queued; an emptied queue stops all polling. While Steam
	 * reports no Internet, nothing is sent: the reconnect signal resumes at once, and the pending
	 * retry only re-checks Steam's state, catching a Steam reconnect the probe did not report.
	 */
	private async flush(): Promise<void> {
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
			logger.error("[PlayTime] Failed to sync pending intervals", error);
		} finally {
			this.flushing = false;
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

	/**
	 * One upload at a time; a commit arriving during a pass requests another snapshot.
	 * Resolves whether polling may stop: the last snapshot left nothing a retry could deliver.
	 */
	private async drain(): Promise<boolean> {
		let settled = true;

		while (this.flushRequested && this.canSync()) {
			this.flushRequested = false;
			settled = true;
			const intervals = await this.queue.pending();

			for (const interval of intervals) {
				const delivery = await this.deliver(interval);

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

	private async deliver(interval: PendingPlaytime): Promise<Delivery> {
		if (!this.canSync()) {
			return "aborted";
		}

		const identifiers = await this.identifiers(interval);

		if (!this.canSync()) {
			return "aborted";
		}

		if (!identifiers) {
			return "deferred";
		}

		const result = await this.queue.upload(interval, identifiers);

		if (result.ok) {
			return "settled";
		}

		logger.error("[PlayTime] Failed to record interval", result);

		if (result.error === "accountMismatch") {
			return "held";
		}

		if (result.error === "refused") {
			return "settled";
		}

		return affectsOnlyThisInterval(result) ? "deferred" : "failed";
	}

	/** Pinned identifiers win, so a shortcut that is no longer recognized still replays. */
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
