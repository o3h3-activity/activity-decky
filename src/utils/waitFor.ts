import { sleep } from "@decky/ui";

const DEFAULT_POLL_INTERVAL_MS = 100;
const DEFAULT_POLL_TIMEOUT_MS = 5000;

/**
 * Polls `condition` until it is truthy, `timeout` elapses, or `signal` aborts.
 *
 * Resolves `true` only when the condition held while `signal` was still live.
 * Timeout and abort resolve `false` rather than throwing: every caller treats
 * both as "do not proceed" and must stay on its fallback path.
 * Cancellation is cooperative: an in-progress condition or sleep still finishes.
 * Callers must recheck the signal after awaiting before applying side effects.
 */
export async function waitFor(
	condition: () => boolean | Promise<boolean>,
	interval = DEFAULT_POLL_INTERVAL_MS,
	timeout = DEFAULT_POLL_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<boolean> {
	const start = Date.now();

	while (!signal?.aborted && Date.now() - start < timeout) {
		if (await condition()) {
			return !signal?.aborted;
		}

		await sleep(interval);
	}

	return false;
}
