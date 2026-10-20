import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LifetimeScope } from "./lifetimeScope";
import { waitForDependency } from "./waitForDependency";

vi.mock(import("@decky/ui"), () => ({
	sleep: (interval: number) => {
		const { promise, resolve } = Promise.withResolvers<void>();

		setTimeout(resolve, interval);

		return promise;
	},
}));

const POLL_INTERVAL_MS = 10;
const READY_TIMEOUT_MS = 100;
const SHORT_TIMEOUT_MS = 20;

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe("waitForDependency", () => {
	it("returns the successful lookup snapshot after missing dependencies", async () => {
		const scope = new LifetimeScope("test");
		const dependency = { service: { ready: true } };
		const lookup = vi.fn<() => typeof dependency | undefined>();

		lookup.mockReturnValueOnce(undefined).mockReturnValueOnce(dependency);

		const pending = waitForDependency(
			scope,
			lookup,
			POLL_INTERVAL_MS,
			READY_TIMEOUT_MS,
		);

		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

		expect(await pending).toBe(dependency);
	});

	it.each([false, 0, ""])(
		"accepts non-nullish dependency %j",
		async (value) => {
			const scope = new LifetimeScope("test");

			expect(
				await waitForDependency(
					scope,
					() => value,
					POLL_INTERVAL_MS,
					READY_TIMEOUT_MS,
				),
			).toBe(value);
		},
	);

	it("times out rather than looking up a dependency after the deadline", async () => {
		const scope = new LifetimeScope("test");
		const state: { dependency?: object } = {};
		const pending = waitForDependency(
			scope,
			() => state.dependency,
			POLL_INTERVAL_MS,
			SHORT_TIMEOUT_MS,
		);

		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
		state.dependency = {};
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

		expect(await pending).toBeUndefined();
	});

	it("does not look up dependencies for an unmounted scope", async () => {
		const scope = new LifetimeScope("test");

		scope.unMount();

		const lookup = vi.fn<() => object>(() => ({}));

		await expect(
			waitForDependency(scope, lookup, POLL_INTERVAL_MS, READY_TIMEOUT_MS),
		).rejects.toBe(scope.signal.reason);

		expect(lookup).not.toHaveBeenCalled();
	});

	it("rejects when unmounted during polling instead of reporting a timeout", async () => {
		const scope = new LifetimeScope("test");
		const pending = waitForDependency(
			scope,
			() => undefined,
			POLL_INTERVAL_MS,
			READY_TIMEOUT_MS,
		).catch((error: unknown) => error);

		await vi.advanceTimersByTimeAsync(0);
		scope.unMount();
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

		expect(await pending).toBe(scope.signal.reason);
	});

	it("rejects a discovered dependency when unmounted before the await resumes", async () => {
		const scope = new LifetimeScope("test");
		const pending = waitForDependency(
			scope,
			() => ({}),
			POLL_INTERVAL_MS,
			READY_TIMEOUT_MS,
		);

		scope.unMount();

		await expect(pending).rejects.toBe(scope.signal.reason);
	});

	it("propagates lookup failures to the owner's install catch", async () => {
		const scope = new LifetimeScope("test");
		const error = new Error("lookup failed");

		await expect(
			waitForDependency(
				scope,
				() => {
					throw error;
				},
				POLL_INTERVAL_MS,
				READY_TIMEOUT_MS,
			),
		).rejects.toBe(error);
	});
});
