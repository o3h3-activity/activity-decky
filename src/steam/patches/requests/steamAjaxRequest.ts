import type { Games } from "@steam/games";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import type { SteamAjaxRequest as SteamAjaxRequestType } from "@typings/steamAjaxRequest";
import { type RedirectRoute, SteamRequestPatcher } from "./requestPatcher";

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
