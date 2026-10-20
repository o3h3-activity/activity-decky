import { TimeoutError } from "es-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RPC_TIMEOUT_MS, rpc } from "./transport";

const boundary = vi.hoisted(() => ({
	request: vi.fn<(name: string, args: unknown[]) => Promise<unknown>>(),
}));

vi.mock(
	import("@decky/api"),
	() =>
		({
			callable:
				(name: string) =>
				(...args: unknown[]) =>
					boundary.request(name, args),
		}) as never,
);

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("RPC transport deadline", () => {
	it("rejects with TimeoutError exactly at the deadline", async () => {
		boundary.request.mockReturnValue(Promise.withResolvers<never>().promise);
		let outcome: unknown = "pending";
		const settled = (async () => {
			try {
				outcome = await rpc("get_debug_enabled")();
			} catch (error: unknown) {
				outcome = error;
			}
		})();

		await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS - 1);
		expect(outcome).toBe("pending");

		await vi.advanceTimersByTimeAsync(1);
		await settled;
		expect(outcome).toBeInstanceOf(TimeoutError);
	});

	it("answers with the backend value and leaves no deadline timer behind", async () => {
		const progress = { Title: "Ico" };

		boundary.request.mockResolvedValue(progress);

		expect(await rpc("get_retro_achievements")("/roms/ico.iso")).toEqual(
			progress,
		);

		expect(boundary.request).toHaveBeenCalledWith("get_retro_achievements", [
			"/roms/ico.iso",
		]);

		expect(vi.getTimerCount()).toBe(0);
	});
});
