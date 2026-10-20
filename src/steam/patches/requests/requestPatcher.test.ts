import type { callOriginal, replacePatch } from "@decky/ui";
import type { Games } from "@steam/games";
import type { AppStore } from "@steam/proxy/appStore";
import type logger from "@utils/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SteamAjaxRequestPatcher } from "./steamAjaxRequest";

type DeckyUiModule = {
	callOriginal: typeof callOriginal;
	replacePatch: typeof replacePatch;
};
type AppStoreModule = {
	AppStore: typeof AppStore;
};
type LoggerModule = {
	default: typeof logger;
};
type PatchCallback = (this: unknown, args: unknown[]) => unknown;

const mocks = vi.hoisted(() => ({
	callback: undefined as PatchCallback | undefined,
	original: vi.fn<(...args: unknown[]) => string>(() => "native-response"),
	callOriginal: Symbol("callOriginal"),
	resolve: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
	unpatch: vi.fn<() => void>(),
}));

vi.mock(
	import("@decky/ui"),
	() =>
		({
			callOriginal: mocks.callOriginal,
			replacePatch: vi.fn<
				(
					target: unknown,
					method: string,
					callback: PatchCallback,
				) => {
					original: typeof mocks.original;
					unpatch: typeof mocks.unpatch;
				}
			>((_target, _method, callback) => {
				mocks.callback = callback;

				return { original: mocks.original, unpatch: mocks.unpatch };
			}),
		}) as unknown as DeckyUiModule,
);

vi.mock(
	import("@steam/proxy/appStore"),
	() =>
		({
			AppStore: { isAppShortcut: vi.fn<() => boolean>(() => true) },
		}) as unknown as AppStoreModule,
);

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: {
				debug: vi.fn<(...args: unknown[]) => void>(),
				error: vi.fn<(...args: unknown[]) => void>(),
			},
		}) as unknown as LoggerModule,
);

const supportedGames = {
	isSupported: (appId: number): boolean => appId === 1,
} as unknown as Games;

const unsupportedGames = {
	isSupported: (appId: number): boolean => appId === 2,
} as unknown as Games;

function createPatcher(games: Games = supportedGames): SteamAjaxRequestPatcher {
	return new SteamAjaxRequestPatcher(
		[
			{
				matchUrl: () => ({ appId: 1, shouldBeRedirected: true }),
				resolve: mocks.resolve,
			},
		],
		{ get: mocks.original } as never,
		{ has: () => false } as never,
		games,
	);
}

async function invokePatchedGet(games?: Games): Promise<unknown> {
	createPatcher(games);

	const args = ["https://steam.test/request"];
	const result: unknown = await mocks.callback?.call({}, args);

	return result === mocks.callOriginal ? mocks.original(...args) : result;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.callback = undefined;
});

describe("SteamAjaxRequestPatcher response boundary", () => {
	it("returns a route's local Steam-shaped payload for a supported shortcut app", async () => {
		mocks.resolve.mockResolvedValue({ success: 1 });

		await expect(invokePatchedGet()).resolves.toEqual({ success: 1 });
		expect(mocks.original).not.toHaveBeenCalled();
	});

	it("preserves Steam's response for an unsupported shortcut app", async () => {
		mocks.resolve.mockResolvedValue({ success: 1 });

		await expect(invokePatchedGet(unsupportedGames)).resolves.toBe(
			"native-response",
		);

		expect(mocks.resolve).not.toHaveBeenCalled();
		expect(mocks.original).toHaveBeenCalledOnce();
	});

	it("falls back to Steam when a local route has no data", async () => {
		mocks.resolve.mockResolvedValue(undefined);

		await expect(invokePatchedGet()).resolves.toBe("native-response");
	});

	it("falls back to Steam when a local route rejects", async () => {
		mocks.resolve.mockRejectedValue(new Error("unavailable"));

		await expect(invokePatchedGet()).resolves.toBe("native-response");
	});
});
