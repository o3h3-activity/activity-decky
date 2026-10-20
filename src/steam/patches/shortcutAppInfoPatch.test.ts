import type { Games } from "@steam/games";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionPatches } from ".";

const mocks = vi.hoisted(() => {
	class Resource {
		installed = false;

		mount = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

		unMount = vi.fn<() => void>();

		isSupported(appId: number): boolean {
			return (
				appId === mocks.SUPPORTED_SHORTCUT_ID ||
				appId === mocks.OVERFLOW_SHORTCUT_ID
			);
		}
	}

	return {
		SUPPORTED_SHORTCUT_ID: 84,
		UNSUPPORTED_SHORTCUT_ID: 42,
		OVERFLOW_SHORTCUT_ID: 2_147_483_648,
		POLL_INTERVAL_MS: 500,
		READY_TIMEOUT_MS: 15_000,
		Resource,
		appInfoStore: {
			FlushPendingAppInfo: async () => undefined,
			GetAppInfo: () => undefined,
			LoadAppInfoBatch: async () => undefined,
			QueueAppInfoRequest: async (_appId: number) => "original",
		},
		callOriginal: Symbol("callOriginal"),
		isAppShortcut: vi.fn<(appId: number) => boolean>(),
	};
});

vi.mock(
	import("@decky/ui"),
	() =>
		({
			callOriginal: mocks.callOriginal,
			findModuleExport: (predicate: (value: unknown) => boolean) =>
				[undefined, {}, mocks.appInfoStore].find(predicate),
			replacePatch: (
				target: typeof mocks.appInfoStore,
				method: "QueueAppInfoRequest",
				callback: (args: unknown[]) => unknown,
			) => {
				const original = target[method];

				target[method] = ((...args: [number]) => {
					const result = callback(args);

					return result === mocks.callOriginal ? original(...args) : result;
				}) as typeof original;

				return {
					original,
					unpatch: () => {
						target[method] = original;
					},
				};
			},
			sleep: (ms: number) => {
				const { promise, resolve } = Promise.withResolvers<void>();

				setTimeout(resolve, ms);

				return promise;
			},
		}) as never,
);

vi.mock(
	import("@steam/achievements/retroAchievements"),
	() =>
		({
			RetroAchievements: mocks.Resource,
		}) as never,
);

vi.mock(
	import("@steam/proxy/appStore"),
	() =>
		({
			AppStore: {
				getAnyAvailableAppOverview: () => ({}),
				isAppShortcut: mocks.isAppShortcut,
			},
		}) as never,
);

vi.mock(
	import("@steam/proxy/steamAjaxRequest"),
	() =>
		({
			SteamAjaxRequest: { getSteamAjaxRequest: () => undefined },
		}) as never,
);

vi.mock(
	import("./overviewPatch"),
	() => ({ OverviewPatch: mocks.Resource }) as never,
);

vi.mock(
	import("./activity"),
	() => ({ SteamActivityTabPatcher: mocks.Resource }) as never,
);

vi.mock(
	import("./shortcuts/clanIdentity"),
	() =>
		({
			ShortcutClanRegistry: mocks.Resource,
		}) as never,
);

vi.mock(
	import("./eventsAndAnnouncements/eventRoutes"),
	() =>
		({
			SteamAdjacentPartnerEventsRoute: {},
			SteamPartnerEventPermissionsRoute: {},
			SteamPartnerEventRoute: {},
			SteamVanityClanIdRoute: {},
		}) as never,
);

vi.mock(import("./community"), () => ({ SteamCommunityRoute: {} }) as never);
vi.mock(import("./gameInfo"), () => ({ SteamGameInfoRoute: {} }) as never);
vi.mock(
	import("./requests/axios"),
	() => ({ SteamAxiosPatcher: mocks.Resource }) as never,
);

vi.mock(
	import("./requests/fetch"),
	() => ({ SteamFetchPatcher: mocks.Resource }) as never,
);

vi.mock(
	import("./requests/steamAjaxRequest"),
	() =>
		({
			SteamAjaxRequestPatcher: mocks.Resource,
		}) as never,
);

vi.mock(import("./yourStuff"), () => ({ SteamYourStuffRoute: {} }) as never);
vi.mock(
	import("./yourStuff/achievements"),
	() =>
		({
			SteamYourStuffAchievementsPatcher: mocks.Resource,
		}) as never,
);

vi.mock(
	import("@utils/logger"),
	() =>
		({ default: { error: vi.fn<(...args: unknown[]) => void>() } }) as never,
);

let session: SessionPatches;

beforeEach(() => {
	vi.useFakeTimers();
	mocks.isAppShortcut.mockReturnValue(true);
	vi.stubGlobal("window", Object.assign(new EventTarget(), { appDetailsStore: {} }));
	session = new SessionPatches(new mocks.Resource() as unknown as Games);
});

afterEach(() => {
	session.unMount();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("session shortcut app-info suppression without OverviewPatch", () => {
	it("suppresses supported shortcuts without achievement rendering and restores on logout", async () => {
		await session.mount();
		await vi.advanceTimersByTimeAsync(0);

		await expect(
			mocks.appInfoStore.QueueAppInfoRequest(mocks.SUPPORTED_SHORTCUT_ID),
		).resolves.toBeUndefined();

		await expect(
			mocks.appInfoStore.QueueAppInfoRequest(mocks.OVERFLOW_SHORTCUT_ID),
		).resolves.toBeUndefined();

		await expect(
			mocks.appInfoStore.QueueAppInfoRequest(mocks.UNSUPPORTED_SHORTCUT_ID),
		).resolves.toBe("original");

		mocks.isAppShortcut.mockReturnValue(false);
		await expect(
			mocks.appInfoStore.QueueAppInfoRequest(mocks.SUPPORTED_SHORTCUT_ID),
		).resolves.toBe("original");

		mocks.isAppShortcut.mockReturnValue(true);

		session.unMount();
		await expect(
			mocks.appInfoStore.QueueAppInfoRequest(mocks.SUPPORTED_SHORTCUT_ID),
		).resolves.toBe("original");
	});

	it("waits for appDetailsStore before discovery", async () => {
		vi.stubGlobal("window", new EventTarget());
		await session.mount();
		await vi.advanceTimersByTimeAsync(0);
		await expect(
			mocks.appInfoStore.QueueAppInfoRequest(mocks.SUPPORTED_SHORTCUT_ID),
		).resolves.toBe("original");

		vi.stubGlobal("window", Object.assign(new EventTarget(), { appDetailsStore: {} }));
		await vi.advanceTimersByTimeAsync(mocks.POLL_INTERVAL_MS);
		await expect(
			mocks.appInfoStore.QueueAppInfoRequest(mocks.SUPPORTED_SHORTCUT_ID),
		).resolves.toBeUndefined();
	});

	it("does not install after logout during readiness polling", async () => {
		vi.stubGlobal("window", new EventTarget());
		await session.mount();
		await vi.advanceTimersByTimeAsync(0);
		session.unMount();

		vi.stubGlobal("window", Object.assign(new EventTarget(), { appDetailsStore: {} }));
		await vi.advanceTimersByTimeAsync(mocks.POLL_INTERVAL_MS);
		await expect(
			mocks.appInfoStore.QueueAppInfoRequest(mocks.SUPPORTED_SHORTCUT_ID),
		).resolves.toBe("original");
	});

	it("keeps requests native when appDetailsStore misses the readiness deadline", async () => {
		vi.stubGlobal("window", new EventTarget());
		await session.mount();
		await vi.advanceTimersByTimeAsync(mocks.READY_TIMEOUT_MS);

		vi.stubGlobal("window", Object.assign(new EventTarget(), { appDetailsStore: {} }));
		await vi.advanceTimersByTimeAsync(mocks.POLL_INTERVAL_MS);
		await expect(
			mocks.appInfoStore.QueueAppInfoRequest(mocks.SUPPORTED_SHORTCUT_ID),
		).resolves.toBe("original");
	});
});
