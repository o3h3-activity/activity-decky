import {
	EAppType,
	type SteamAppOverview,
} from "@decky/ui/dist/globals/steam-client/App";
import type { SteamAppStore } from "@typings/appStore";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";

export class AppStore {
	public static getAppOverviewByAppID(
		appId: number,
	): Nullable<SteamAppOverview> {
		if (isNil(window.appStore)) {
			return undefined;
		}

		return window.appStore.GetAppOverviewByAppID(appId);
	}

	public static getShortcutAppIds(): number[] | undefined {
		if (isNil(window.appStore)) {
			return undefined;
		}

		const appStore = window.appStore as SteamAppStore;
		const apps = appStore.m_mapApps;

		if (isNil(apps)) {
			return undefined;
		}

		const shortcutIds: number[] = [];

		for (const [appId, overview] of apps) {
			if (
				overview.app_type === EAppType.Shortcut &&
				!overview.third_party_mod
			) {
				shortcutIds.push(appId);
			}
		}

		return shortcutIds;
	}

	private static getAppOverviewFromFirstAllAppsAvailable(): Nullable<SteamAppOverview> {
		if (isNil(window.appStore)) {
			return undefined;
		}

		const appStore = window.appStore as SteamAppStore;

		if (Array.isArray(appStore.allApps) && appStore.allApps.length > 0) {
			return appStore.allApps[0];
		}

		return undefined;
	}

	private static getAppOverviewFromFirstMapAppsAvailable(): Nullable<SteamAppOverview> {
		if (isNil(window.appStore)) {
			return undefined;
		}

		const appStore = window.appStore as SteamAppStore;
		const first = appStore.m_mapApps?.values().next();

		if (isNil(first) || first.done) {
			return undefined;
		}

		return first.value;
	}

	public static getAnyAvailableAppOverview(): Nullable<SteamAppOverview> {
		const appOverviewFromFirstAllAppsAvailable =
			AppStore.getAppOverviewFromFirstAllAppsAvailable();

		if (appOverviewFromFirstAllAppsAvailable) {
			return appOverviewFromFirstAllAppsAvailable;
		}

		const appOverviewFromFirstMapAppsAvailable =
			AppStore.getAppOverviewFromFirstMapAppsAvailable();

		if (appOverviewFromFirstMapAppsAvailable) {
			return appOverviewFromFirstMapAppsAvailable;
		}

		return undefined;
	}

	public static isAppShortcut(appId: number): Nullable<boolean> {
		const appOverviewByAppID = AppStore.getAppOverviewByAppID(appId);

		if (isNil(appOverviewByAppID)) {
			return undefined;
		}

		if (isNil(appOverviewByAppID?.app_type)) {
			logger.error(
				`Impossible to get \`app_type\` for \`${appId}\` appId. Maybe something is wrong.`,
			);

			return undefined;
		}

		if (appOverviewByAppID.third_party_mod) {
			return appOverviewByAppID.third_party_mod;
		}

		return appOverviewByAppID.app_type === EAppType.Shortcut;
	}
}
