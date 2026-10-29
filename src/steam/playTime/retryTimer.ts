/** First retry delay; doubles per further scheduled retry until reset. */
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 900_000;

/** Retry timer with a doubling delay, holding at most one pending retry. */
export class RetryTimer {
	private delay = BASE_DELAY_MS;
	private timer: ReturnType<typeof setTimeout> | undefined;

	/** Jittered so devices that failed together during an outage do not retry in lockstep. */
	schedule(retry: () => void): void {
		if (this.timer !== undefined) {
			return;
		}

		const delay = this.delay;

		this.delay = Math.min(delay * 2, MAX_DELAY_MS);
		this.timer = setTimeout(
			() => {
				this.timer = undefined;
				retry();
			},
			// eslint-disable-next-line sonarjs/pseudo-random -- Retry jitter, not a secret.
			delay / 2 + (Math.random() * delay) / 2,
		);
	}

	cancel(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	reset(): void {
		this.delay = BASE_DELAY_MS;
	}
}
