import type { Games } from "@steam/games";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import type { SteamAjaxRequest as SteamAjaxRequestType } from "@typings/steamAjaxRequest";
import { type RedirectRoute, SteamRequestPatcher } from "./requestPatcher";

/**
 * Hooks the shared `window.steamAjaxRequest` client's GET method.
 *
 * Unlike Axios, this client returns the decoded body directly. For example,
 * the community-feed caller reads `response.hub`, not `response.data.hub`.
 * Route results need no extra wrapper here.
 */
export class SteamAjaxRequestPatcher extends SteamRequestPatcher {
	constructor(
		routes: readonly RedirectRoute[],
		steamAjaxRequest: SteamAjaxRequestType,
		shortcutClans: ShortcutClanRegistry,
		games: Games,
	) {
		super(routes, "SteamAjaxRequestPatcher", shortcutClans, games);

		this.patchGet(steamAjaxRequest);
	}
}
