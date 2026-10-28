import type { DeviceAuthorizationStatus } from "@api/account";
import { LifetimeScope } from "@steam/lifetimeScope";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	mountPlayTimeSync,
	playTimeSyncStore,
	savePlayTimeSync,
} from "./playTimeSync";

const boundary = vi.hoisted(() => ({
	get: vi.fn<() => Promise<boolean>>(),
	set: vi.fn<(enabled: boolean) => Promise<void>>(),
	authorization:
		vi.fn<() => undefined | { status: DeviceAuthorizationStatus }>(),
}));

vi.mock(
	import("@api/settings"),
	() =>
		({
			getIsPlayTimeSyncEnabled: boundary.get,
			setIsPlayTimeSyncEnabled: boundary.set,
		}) as never,
);

vi.mock(
	import("@stores/account"),
	() =>
		({
			accountStore: { authorization: { peek: boundary.authorization } },
		}) as never,
);

vi.mock(
	import("@utils/logger"),
	() => ({ default: { error: vi.fn<() => void>() } }) as never,
);

let scope: LifetimeScope;

beforeEach(() => {
	boundary.get.mockReset();
	boundary.set.mockReset();
	boundary.set.mockResolvedValue(undefined);
	boundary.authorization.mockReturnValue({ status: "signedIn" });
	scope = new LifetimeScope("PlayTime sync test");
});

afterEach(() => {
	scope.unMount();
});

describe("PlayTime sync store", () => {
	it("rejects changing the saved choice while signed out", async () => {
		playTimeSyncStore.isEnabled.set(true);
		boundary.authorization.mockReturnValue({ status: "signedOut" });

		await expect(savePlayTimeSync(false)).rejects.toBeInstanceOf(Error);
		expect(boundary.set).not.toHaveBeenCalled();
		expect(playTimeSyncStore.peek()).toStrictEqual({ isEnabled: true });
	});

	it("keeps a choice saved while the initial load is still pending", async () => {
		const load = Promise.withResolvers<boolean>();

		boundary.get.mockReturnValue(load.promise);
		mountPlayTimeSync(scope);
		await savePlayTimeSync(true);
		load.resolve(false);
		await load.promise;
		await Promise.resolve();

		expect(playTimeSyncStore.peek()).toStrictEqual({ isEnabled: true });
	});

	it("leaves sharing off when the saved choice cannot be loaded", async () => {
		boundary.get.mockRejectedValue(new Error("backend down"));
		mountPlayTimeSync(scope);

		// Settled off, not left `undefined`, so the Quick Access Menu stops showing "Checking…".
		await vi.waitFor(() => {
			expect(playTimeSyncStore.peek()).toStrictEqual({ isEnabled: false });
		});
	});

	it("keeps the previous choice when saving fails", async () => {
		boundary.get.mockResolvedValue(true);
		mountPlayTimeSync(scope);
		await vi.waitFor(() => {
			expect(playTimeSyncStore.peek()).toStrictEqual({ isEnabled: true });
		});

		boundary.set.mockRejectedValue(new Error("disk full"));

		await expect(savePlayTimeSync(false)).rejects.toThrow("disk full");
		expect(playTimeSyncStore.peek()).toStrictEqual({ isEnabled: true });
	});
});
