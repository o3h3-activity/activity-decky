import logger from "@utils/logger";
import { describe, expect, it, vi } from "vitest";
import { LifetimeScope } from "./lifetimeScope";

vi.mock(
	import("@utils/logger"),
	() =>
		({ default: { error: vi.fn<(...args: unknown[]) => void>() } }) as never,
);

describe("LifetimeScope.installGuarded", () => {
	it("keeps a successful installation until its owner unmounts", async () => {
		const scope = new LifetimeScope("test");
		let state = "native";

		scope.installGuarded(async () => {
			state = "patched";
			scope.addDisposer(() => {
				state = "native";
			});
		}, "installation failed");

		await Promise.resolve();

		expect(state).toBe("patched");
		expect(scope.signal.reason).toBeUndefined();

		scope.unMount();
		expect(state).toBe("native");
	});

	it("logs a live rejection before rolling back a partial installation", async () => {
		const scope = new LifetimeScope("test");
		const error = new Error("installation failed");
		let state = "native";

		vi.mocked(logger.error).mockClear();
		scope.installGuarded(async () => {
			state = "patched";
			scope.addDisposer(() => {
				expect(logger.error).toHaveBeenCalledWith("patch failed", error);
				state = "native";
			});

			throw error;
		}, "patch failed");

		await Promise.resolve();

		expect(scope.signal.reason).toBeInstanceOf(DOMException);
		expect(state).toBe("native");
		expect(logger.error).toHaveBeenCalledExactlyOnceWith("patch failed", error);
	});

	it("ignores a rejection when the lifetime ends before the catch runs", async () => {
		const scope = new LifetimeScope("test");
		const unMount = vi.spyOn(scope, "unMount");

		vi.mocked(logger.error).mockClear();
		scope.installGuarded(
			() => Promise.reject(new Error("late failure")),
			"patch failed",
		);

		scope.unMount();
		await Promise.resolve();

		expect(logger.error).not.toHaveBeenCalled();
		expect(unMount).toHaveBeenCalledOnce();
	});
});
