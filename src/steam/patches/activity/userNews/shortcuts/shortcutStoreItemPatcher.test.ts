/* oxlint-disable vitest/prefer-strict-boolean-matchers -- Conflicts with the required prefer-to-be-truthy/falsy rules. */
import type { callOriginal, replacePatch } from "@decky/ui";
import type { Games } from "@steam/games";
import type { AppStore } from "@steam/proxy/appStore";
import type { QueryCacheEvent, SteamQueryClient } from "@typings/queryClient";
import type { SteamStoreItemCache } from "@typings/storeItemCache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DeckyUiModule = {
	callOriginal: typeof callOriginal;
	replacePatch: typeof replacePatch;
};
type AppStoreModule = { AppStore: typeof AppStore };

const APP_ID = 123;
const OTHER_APP_ID = 456;
const STORE_QUERY = ["StoreItem", "app_123", "default_info"];
const patchers: ShortcutStoreItemPatcher[] = [];

const mocks = vi.hoisted(() => ({
	callOriginal: Symbol("callOriginal"),
	overview: { display_name: "Fixture Game", visible_in_game_list: true },
	isAppShortcut: vi.fn<(appId: number) => boolean>(() => true),
	isSupported: vi.fn<(appId: number) => boolean>(() => false),
	unpatch: vi.fn<() => void>(),
}));

vi.mock(
	import("@decky/ui"),
	() =>
		({
			callOriginal: mocks.callOriginal,
			replacePatch: vi.fn<
				(
					target: Record<string, unknown>,
					method: string,
					callback: (args: unknown[]) => unknown,
				) => { original: unknown; unpatch: () => void }
			>((target, method, callback) => {
				const original = target[method];

				target[method] = function (...args: unknown[]) {
					const result = callback(args);

					return result === mocks.callOriginal && typeof original === "function"
						? Reflect.apply(original, this, args)
						: result;
				};

				return {
					original,
					unpatch: () => {
						target[method] = original;
						mocks.unpatch();
					},
				};
			}),
		}) as unknown as DeckyUiModule,
);

vi.mock(
	import("@steam/proxy/appStore"),
	() =>
		({
			AppStore: {
				getAppOverviewByAppID: vi.fn<() => typeof mocks.overview>(
					() => mocks.overview,
				),
				isAppShortcut: mocks.isAppShortcut,
			},
		}) as unknown as AppStoreModule,
);

import { ShortcutStoreItemPatcher } from "./shortcutStoreItemPatcher";

function createClient(): SteamQueryClient {
	const data = new Map<string, unknown>();
	const listeners = new Set<(event: QueryCacheEvent) => void>();

	return {
		cancelQueries: async () => undefined,
		getQueryCache: () => ({
			subscribe: (listener) => {
				listeners.add(listener);

				return () => {
					listeners.delete(listener);
				};
			},
		}),
		getQueryData: (key) => data.get(JSON.stringify(key)),
		invalidateQueries: () => undefined,
		removeQueries: ({ queryKey }) => {
			data.delete(JSON.stringify(queryKey));
		},
		resetQueries: async () => undefined,
		setQueryData: (key, value) => {
			data.set(JSON.stringify(key), value);

			for (const listener of listeners) {
				listener({
					action: { type: "success" },
					query: { queryKey: [...key] },
					type: "updated",
				});
			}

			return value;
		},
	};
}

function createPatcher(): ShortcutStoreItemPatcher {
	const patcher = new ShortcutStoreItemPatcher({
		isSupported: mocks.isSupported,
	} as unknown as Games);

	patchers.push(patcher);

	return patcher;
}

function createCache(): SteamStoreItemCache {
	return { m_mapApps: new Map() } as unknown as SteamStoreItemCache;
}

function nativeStoreInfo(
	appId: number,
	name: string,
	visible = false,
): Record<string, unknown> {
	return {
		id: appId,
		item_type: 0,
		name,
		visible,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.isAppShortcut.mockReturnValue(true);
	mocks.isSupported.mockReturnValue(false);
	mocks.overview.display_name = "Fixture Game";
	mocks.overview.visible_in_game_list = true;
});

afterEach(() => {
	for (const patcher of patchers.splice(0)) {
		patcher.unMount();
	}
});

describe("ShortcutStoreItemPatcher", () => {
	it("does not expose cached or synthetic store items for unsupported shortcuts", () => {
		const cache = createCache();
		const client = createClient();
		const patcher = createPatcher();

		cache.m_mapApps.set(APP_ID, { native: true } as never);
		patcher.install(cache, client);

		expect(patcher.ensure(APP_ID)).toBeFalsy();
		expect(cache.m_mapApps.get(APP_ID)).toEqual({ native: true });
		expect(client.getQueryData(STORE_QUERY)).toBeUndefined();
		patcher.unMount();
	});

	it("publishes metadata only for visible supported shortcuts", () => {
		const client = createClient();
		const patcher = createPatcher();

		mocks.isSupported.mockReturnValue(true);
		mocks.overview.visible_in_game_list = false;
		patcher.install(createCache(), client);

		expect(patcher.ensure(APP_ID)).toBeFalsy();
		expect(client.getQueryData(STORE_QUERY)).toBeUndefined();
		patcher.unMount();
	});

	it("repairs native StoreBrowse writes with the latest shortcut metadata", () => {
		const client = createClient();
		const patcher = createPatcher();

		mocks.isSupported.mockReturnValue(true);
		patcher.install(createCache(), client);
		expect(patcher.ensure(APP_ID)).toBeTruthy();

		client.setQueryData(
			STORE_QUERY,
			nativeStoreInfo(APP_ID, "Missing store item"),
		);

		expect(client.getQueryData(STORE_QUERY)).toEqual({
			id: APP_ID,
			name: "Fixture Game",
			visible: true,
		});

		mocks.overview.display_name = "Renamed Shortcut";
		client.setQueryData(STORE_QUERY, nativeStoreInfo(APP_ID, "Still missing"));

		expect(client.getQueryData(STORE_QUERY)).toEqual({
			id: APP_ID,
			name: "Renamed Shortcut",
			visible: true,
		});
	});

	it("refreshes seeded metadata when the local shortcut is renamed", () => {
		const client = createClient();
		const patcher = createPatcher();

		mocks.isSupported.mockReturnValue(true);
		patcher.install(createCache(), client);
		patcher.ensure(APP_ID);
		mocks.overview.display_name = "Renamed Shortcut";
		patcher.ensure(APP_ID);

		expect(client.getQueryData(STORE_QUERY)).toEqual({
			id: APP_ID,
			name: "Renamed Shortcut",
			visible: true,
		});
	});

	it("leaves scoped, unrelated, and non-native StoreItem replacements alone", () => {
		const client = createClient();
		const patcher = createPatcher();
		const scopedQuery = [...STORE_QUERY, "country-US"];
		const unrelatedQuery = ["StoreItem", "app_456", "default_info"];
		const replacement = {
			id: APP_ID,
			name: "Third-party metadata",
			visible: false,
		};

		mocks.isSupported.mockReturnValue(true);
		patcher.install(createCache(), client);
		patcher.ensure(APP_ID);
		client.setQueryData(
			scopedQuery,
			nativeStoreInfo(APP_ID, "Scoped native metadata"),
		);

		client.setQueryData(
			unrelatedQuery,
			nativeStoreInfo(OTHER_APP_ID, "Unrelated native metadata"),
		);

		client.setQueryData(STORE_QUERY, replacement);
		patcher.unMount();

		expect(client.getQueryData(scopedQuery)).toEqual(
			nativeStoreInfo(APP_ID, "Scoped native metadata"),
		);

		expect(client.getQueryData(unrelatedQuery)).toEqual(
			nativeStoreInfo(OTHER_APP_ID, "Unrelated native metadata"),
		);

		expect(client.getQueryData(STORE_QUERY)).toEqual(replacement);
	});

	it("restores former query owners but preserves later replacements", () => {
		const client = createClient();
		const previous = { id: APP_ID, name: "Existing owner", visible: false };
		const replacement = { id: APP_ID, name: "Later owner", visible: false };

		mocks.isSupported.mockReturnValue(true);
		client.setQueryData(STORE_QUERY, previous);

		const firstPatcher = createPatcher();

		firstPatcher.install(createCache(), client);
		firstPatcher.ensure(APP_ID);
		firstPatcher.unMount();

		expect(client.getQueryData(STORE_QUERY)).toEqual(previous);

		const secondPatcher = createPatcher();

		secondPatcher.install(createCache(), client);
		secondPatcher.ensure(APP_ID);
		client.setQueryData(STORE_QUERY, replacement);
		secondPatcher.unMount();

		expect(client.getQueryData(STORE_QUERY)).toEqual(replacement);
	});

	it("unsubscribes before restoring native metadata owned before installation", () => {
		const client = createClient();
		const patcher = createPatcher();
		const previous = nativeStoreInfo(APP_ID, "Previous native owner");

		client.setQueryData(STORE_QUERY, previous);
		mocks.isSupported.mockReturnValue(true);
		patcher.install(createCache(), client);
		patcher.ensure(APP_ID);
		patcher.unMount();

		expect(client.getQueryData(STORE_QUERY)).toEqual(previous);
	});
});
