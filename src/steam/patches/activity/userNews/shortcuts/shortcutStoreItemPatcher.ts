import { callOriginal, replacePatch } from "@decky/ui";
import type { SteamAppOverview } from "@decky/ui/dist/globals/steam-client/App";
import { EResult } from "@decky/ui/dist/globals/steam-client/shared";
import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import { isSupportedShortcut } from "@steam/patches/shortcutEligibility";
import { AppStore } from "@steam/proxy/appStore";
import type { QueryCacheEvent, SteamQueryClient } from "@typings/queryClient";
import type {
	SteamStoreItem,
	SteamStoreItemAssets,
	SteamStoreItemCache,
} from "@typings/storeItemCache";
import { isObjectLike } from "@utils/isObjectLike";
import { isSafeInteger } from "@utils/safeInteger";

type ShortcutStoreInfo = {
	id: number;
	name: string;
	visible: boolean;
};
type ManagedStoreQuery = {
	info: ShortcutStoreInfo;
	key: readonly unknown[];
	previous: unknown;
	value: unknown;
};
const STORE_ITEM_APP_PREFIX = "app_";
const returnUndefined = (): undefined => undefined;
const returnFalse = (): false => false;

function assetFallback(property: string): unknown {
	return property.startsWith("Get") ? returnUndefined : undefined;
}

function storeItemFallback(property: string): unknown {
	return property.startsWith("B") ? returnFalse : assetFallback(property);
}

/**
 * Serves shortcut metadata to Steam's activity preparation cache and the
 * StoreItem queries used by its renderer; restores only data it owns on unmount.
 */
export class ShortcutStoreItemPatcher {
	private cache: SteamStoreItemCache | undefined;
	private queryClient: SteamQueryClient | undefined;
	private readonly mockedQueries = new Map<number, ManagedStoreQuery>();
	private readonly mockedItems = new Map<number, SteamStoreItem>();
	private readonly scope = new LifetimeScope("UserNews/ShortcutStoreItems");

	constructor(private readonly games: Games) {
		this.scope.addDisposer(() => {
			this.removeMockedItems();
		});
	}

	/**
	 * Adopts Steam's StoreItem cache and answers supported shortcut
	 * QueueStoreItemRequest calls locally.
	 */
	install(cache: SteamStoreItemCache, queryClient: SteamQueryClient): void {
		this.cache = cache;
		this.queryClient = queryClient;
		this.subscribeToNativeStoreQueryWrites(queryClient);
		this.scope.add(
			replacePatch(cache, "QueueStoreItemRequest", (args: unknown[]) => {
				const appId = args[0];

				if (!isSafeInteger(appId) || !this.ensure(appId)) {
					return callOriginal;
				}

				return Promise.resolve(EResult.OK);
			}),
		);
	}

	/**
	 * True when a supported shortcut has a StoreItem (native or synthetic); false
	 * before install, after unmount, or for an ineligible shortcut.
	 */
	ensure(appId: number): boolean {
		if (this.scope.signal.aborted) {
			return false;
		}

		const { cache, queryClient } = this;

		if (!cache || !queryClient) {
			return false;
		}

		if (!isSupportedShortcut(this.games, appId)) {
			return false;
		}

		const overview = AppStore.getAppOverviewByAppID(appId);

		if (!overview?.visible_in_game_list) {
			return false;
		}

		this.ensureStoreQuery(appId, overview, queryClient);

		if (cache.m_mapApps.has(appId)) {
			return true;
		}

		const storeItem = ShortcutStoreItemPatcher.createStoreItem(appId, overview);

		cache.m_mapApps.set(appId, storeItem);
		this.mockedItems.set(appId, storeItem);

		return true;
	}

	unMount(): void {
		this.scope.unMount();
	}

	private subscribeToNativeStoreQueryWrites(client: SteamQueryClient): void {
		this.scope.addDisposer(
			client.getQueryCache().subscribe((event) => {
				this.restoreShortcutStoreQuery(event, client);
			}),
		);
	}

	private restoreShortcutStoreQuery(
		event: QueryCacheEvent,
		client: SteamQueryClient,
	): void {
		if (event.type !== "updated" || event.action?.type !== "success") {
			return;
		}

		const query = this.getManagedStoreQuery(event.query.queryKey);

		if (!query) {
			return;
		}

		const current = client.getQueryData(query.key);

		if (
			current === query.value ||
			!isObjectLike(current) ||
			!("id" in current) ||
			current.id !== query.info.id ||
			!("item_type" in current) ||
			typeof current.item_type !== "number" ||
			!isSupportedShortcut(this.games, query.info.id)
		) {
			return;
		}

		const overview = AppStore.getAppOverviewByAppID(query.info.id);

		if (!overview?.visible_in_game_list) {
			return;
		}

		// StoreBrowse asset loads also publish default_info. Steam does not own
		// shortcut metadata, so restore it from the local overview.
		query.info = {
			id: query.info.id,
			name: overview.display_name,
			visible: overview.visible_in_game_list,
		};

		query.value = client.setQueryData(query.key, query.info);
	}

	private getManagedStoreQuery(
		key: readonly unknown[] | undefined,
	): ManagedStoreQuery | undefined {
		if (
			key?.[0] !== "StoreItem" ||
			typeof key[1] !== "string" ||
			!key[1].startsWith(STORE_ITEM_APP_PREFIX) ||
			key[2] !== "default_info"
		) {
			return undefined;
		}

		const query = this.mockedQueries.get(
			Number(key[1].slice(STORE_ITEM_APP_PREFIX.length)),
		);

		return key.length === query?.key.length && key[1] === query?.key[1]
			? query
			: undefined;
	}

	private ensureStoreQuery(
		appId: number,
		overview: SteamAppOverview,
		client: SteamQueryClient,
	): void {
		let query = this.mockedQueries.get(appId);

		if (
			query?.info.name === overview.display_name &&
			query.info.visible === overview.visible_in_game_list &&
			client.getQueryData(query.key) === query.value
		) {
			return;
		}

		const info: ShortcutStoreInfo = {
			id: appId,
			name: overview.display_name,
			visible: overview.visible_in_game_list,
		};

		if (!query) {
			// The library StoreBrowse context has no cacheScope suffix.
			const key = ["StoreItem", `app_${appId}`, "default_info"];

			query = {
				key,
				previous: client.getQueryData(key),
				info,
				value: undefined,
			};

			this.mockedQueries.set(appId, query);
		}

		// An older request must not replace local metadata with "not in store".
		void client.cancelQueries(
			{ queryKey: query.key, exact: true },
			{ revert: false },
		);

		query.info = info;
		query.value = client.setQueryData(query.key, info);
	}

	private removeMockedItems(): void {
		for (const [appId, item] of this.mockedItems) {
			if (this.cache?.m_mapApps.get(appId) === item) {
				this.cache.m_mapApps.delete(appId);
			}
		}

		this.mockedItems.clear();

		for (const query of this.mockedQueries.values()) {
			const client = this.queryClient;

			if (!client || client.getQueryData(query.key) !== query.value) {
				continue;
			}

			if (query.previous === undefined) {
				client.removeQueries({ queryKey: query.key, exact: true });
			} else {
				client.setQueryData(query.key, query.previous);
			}
		}

		this.mockedQueries.clear();
		this.queryClient = undefined;
		this.cache = undefined;
	}

	private static createStoreItem(
		appId: number,
		overview: SteamAppOverview,
	): SteamStoreItem {
		const assets =
			ShortcutStoreItemPatcher.withMethodFallbacks<SteamStoreItemAssets>(
				{ GetCommunityIconURL: returnUndefined },
				assetFallback,
			);

		return ShortcutStoreItemPatcher.withMethodFallbacks<SteamStoreItem>(
			{
				BContainDataRequest: () => true,
				BIsApplicationOrTool: returnFalse,
				BIsVisible: () =>
					Boolean(AppStore.getAppOverviewByAppID(appId)?.visible_in_game_list),
				BLimitedLaunchActive: returnFalse,
				GetAssets: () => assets,
				GetIncludedAppIDs: () => [],
				GetName: () =>
					AppStore.getAppOverviewByAppID(appId)?.display_name ??
					overview.display_name,
			},
			storeItemFallback,
		);
	}

	private static withMethodFallbacks<T extends object>(
		target: T,
		fallback: (property: string) => unknown,
	): T {
		return new Proxy<T>(target, {
			get(proxyTarget, property, receiver) {
				const value: unknown = Reflect.get(proxyTarget, property, receiver);

				if (value !== undefined || typeof property !== "string") {
					return value;
				}

				return fallback(property);
			},
		});
	}
}
