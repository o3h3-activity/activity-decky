import type { SteamAppActivity } from "@typings/appActivityStore";

export abstract class AppActivityStore {
	public static getAppActivity(appId: number): Nullable<SteamAppActivity> {
		return window.appActivityStore?.m_mapAppActivity?.get(appId);
	}

	/** Signed-in user's 64-bit SteamID string. */
	public static getCurrentUserSteamId(): Nullable<string> {
		return window.appActivityStore?.CMInterface?.steamid?.ConvertTo64BitString();
	}
}
