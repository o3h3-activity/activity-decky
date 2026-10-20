import type { EResult } from "@decky/ui/dist/globals/steam-client/shared";

export type SteamStoreItemAssets = {
	GetCommunityIconURL(): undefined;
};

export type SteamStoreItem = {
	BContainDataRequest(): boolean;
	BIsApplicationOrTool(): boolean;
	BIsVisible(): boolean;
	BLimitedLaunchActive(): false;
	GetAssets(): SteamStoreItemAssets;
	GetIncludedAppIDs(): [];
	GetName(): string;
};

export type SteamStoreItemCache = {
	m_mapApps: Map<number, SteamStoreItem>;
	QueueStoreItemRequest: (...args: unknown[]) => Promise<EResult>;
};

declare global {
	interface Window {
		StoreItemCache?: SteamStoreItemCache;
	}
}
