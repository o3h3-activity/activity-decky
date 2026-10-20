import { waitFor } from "@utils/waitFor";
import { isNil } from "es-toolkit";
import type { LifetimeScope } from "./lifetimeScope";

export const DEPENDENCY_POLL_INTERVAL_MS = 500;
export const DEPENDENCY_READY_TIMEOUT_MS = 15_000;

/**
 * Polls for a non-nullish dependency, preserving the successful lookup value.
 * Timeout returns undefined; cancellation throws for the owner's install catch.
 * The caller owns dependency grouping, timing, diagnostics, and installation.
 */
export async function waitForDependency<T>(
	scope: LifetimeScope,
	lookup: () => T,
	interval: number,
	timeout: number,
): Promise<NonNullable<T> | undefined> {
	scope.signal.throwIfAborted();

	let dependency: T | undefined;
	const found = await waitFor(
		() => {
			dependency = lookup();

			return !isNil(dependency);
		},
		interval,
		timeout,
		scope.signal,
	);

	scope.signal.throwIfAborted();

	return found ? (dependency ?? undefined) : undefined;
}
