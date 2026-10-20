import { type SteamAppOverview } from "@decky/ui/dist/globals/steam-client/App";
import "@decky/ui/dist/globals/stores";

/**
 * Extra runtime fields on live AppOverview instances.
 * Augments Decky's exported interface — every `SteamAppOverview` import sees these.
 * Add keys here.
 */
declare module "@decky/ui/dist/globals/steam-client/App" {
	interface SteamAppOverview {
		m_gameid?: string;
		m_ulGameId?: { low: number };
	}
}

/**
 * Runtime methods inherited by live AppOverview instances.
 * These are absent from Decky's serialized AppOverview declaration.
 */
export interface AppOverviewPrototype {
	BIsModOrShortcut(this: SteamAppOverview): boolean;
	GetGameID(this: SteamAppOverview): string;
	GetPrimaryAppID(this: SteamAppOverview): number;
}

/**
 * Recover Decky's unexported `AppStoreAppOverview` from a store method param.
 * `Window.appStore` is an inline object type, so it cannot be declaration-merged.
 */
export type DeckyAppStoreOverview = Parameters<
	Window["appStore"]["GetIconURLForApp"]
>[0];

export type SteamAppStore = Window["appStore"] & {
	allApps: SteamAppOverview[];
	m_mapApps: Map<number, SteamAppOverview>;
};
