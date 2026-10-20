import type { SteamStoreItemCache } from "@typings/storeItemCache";

export abstract class StoreItemCache {
	public static getStoreItemCache(): Nullable<SteamStoreItemCache> {
		return window.StoreItemCache;
	}
}
