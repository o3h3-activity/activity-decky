import type { AppAchievement } from "@decky/ui/dist/globals/steam-client/App";
import type { SteamId } from "./friendStore";
import type { SteamUserNewsProtoEvent } from "./userNewsService";

export type SteamAppActivity = {
	AddNewsEvents(events: SteamUserNewsProtoEvent[]): Promise<unknown>;
	m_AchievementMap: Map<number, Map<string, AppAchievement>>;
	m_bNoMoreHistoryAvailable: boolean;
	m_mapActivityByDay: Map<
		number,
		{ events: Array<{ commentThreads?: unknown[] }> }
	>;
	m_rtNewestActivityTime: number;
	m_rtOldestActivityTime: number;
	SortEvents(): void;
};

export type SteamAppActivityStore = {
	CMInterface?: { steamid?: SteamId };
	m_mapAppActivity?: Map<number, SteamAppActivity>;
};

declare global {
	interface Window {
		appActivityStore?: SteamAppActivityStore;
	}
}
