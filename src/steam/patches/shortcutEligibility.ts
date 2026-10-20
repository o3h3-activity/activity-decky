import type { Games } from "@steam/games";
import { AppStore } from "@steam/proxy/appStore";

/** Only shortcuts may trigger Games' background identification on a support lookup. */
export function isSupportedShortcut(games: Games, appId: number): boolean {
	return AppStore.isAppShortcut(appId) === true && games.isSupported(appId);
}
