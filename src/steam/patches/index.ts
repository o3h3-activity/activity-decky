import { RetroAchievements } from "@steam/achievements/retroAchievements";
import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import { AppStore } from "@steam/proxy/appStore";
import { SteamAjaxRequest } from "@steam/proxy/steamAjaxRequest";
import type { SessionResource } from "@steam/sessionLifecycle";
import logger from "@utils/logger";
import { waitFor } from "@utils/waitFor";
import { isNil } from "es-toolkit";
import { SteamActivityTabPatcher } from "./activity";
import { SteamCommunityRoute } from "./community";
import {
	SteamAdjacentPartnerEventsRoute,
	SteamPartnerEventPermissionsRoute,
	SteamPartnerEventRoute,
	SteamVanityClanIdRoute,
} from "./eventsAndAnnouncements/eventRoutes";
import { ShortcutClanImagePatch } from "./eventsAndAnnouncements/shortcutClanImagePatch";
import { SteamGameInfoRoute } from "./gameInfo";
import { OverviewPatch } from "./overviewPatch";
import { SteamAxiosPatcher } from "./requests/axios";
import { SteamFetchPatcher } from "./requests/fetch";
import type { RedirectRoute } from "./requests/requestPatcher";
import { SteamAjaxRequestPatcher } from "./requests/steamAjaxRequest";
import { ShortcutAppInfoPatch } from "./shortcutAppInfoPatch";
import { ShortcutClanRegistry } from "./shortcuts/clanIdentity";
import { SteamYourStuffRoute } from "./yourStuff";
import { SteamYourStuffAchievementsPatcher } from "./yourStuff/achievements";

const STEAM_AJAX_REDIRECT_ROUTES = [
	SteamYourStuffRoute,
	SteamCommunityRoute,
	SteamGameInfoRoute,
] satisfies readonly RedirectRoute[];

const AXIOS_REDIRECT_ROUTES = [
	SteamVanityClanIdRoute,
	SteamPartnerEventRoute,
	SteamAdjacentPartnerEventsRoute,
	SteamPartnerEventPermissionsRoute,
] satisfies readonly RedirectRoute[];

const FETCH_REDIRECT_ROUTES = [
	SteamVanityClanIdRoute,
	SteamPartnerEventPermissionsRoute,
] satisfies readonly RedirectRoute[];

const OVERVIEW_POLL_INTERVAL_MS = 500;

/** Every Steam patch for one login; see `SessionLifecycle`. */
export class SessionPatches implements SessionResource {
	private readonly scope = new LifetimeScope("SessionPatches");

	constructor(private readonly games: Games) {}

	/**
	 * Waits for an app overview, then starts best-effort patch installation.
	 * Child patchers own their readiness waits and may still be installing when
	 * this resolves. Logout cancels both this wait and child installation.
	 */
	async mount(): Promise<void> {
		// Steam can become ready long after login; logout cancels this wait.
		const ready = await waitFor(
			() => !isNil(AppStore.getAnyAvailableAppOverview()),
			OVERVIEW_POLL_INTERVAL_MS,
			Number.POSITIVE_INFINITY,
			this.scope.signal,
		);

		if (ready && !this.scope.signal.aborted) {
			this.initializePatches();
		}
	}

	unMount(): void {
		this.scope.unMount();
	}

	private initializePatches(): void {
		const achievementsProvider = this.scope.track(
			new RetroAchievements(this.games),
		);

		// Shared shortcut compatibility must not depend on OverviewPatch.
		this.scope.track(new ShortcutAppInfoPatch(this.games));
		const shortcutClans = new ShortcutClanRegistry();
		const overviewPatch = this.scope.track(new OverviewPatch(this.games));

		if (!overviewPatch.installed) {
			logger.error(
				"[SessionPatches] AppOverview patch unavailable; Activity and request redirects disabled.",
			);
			// Achievement patching has no dependency on shortcut Activity sections.

			this.scope.track(
				new SteamYourStuffAchievementsPatcher(achievementsProvider, this.games),
			);

			return;
		}

		this.scope.track(new ShortcutClanImagePatch(shortcutClans));

		this.scope.track(
			new SteamActivityTabPatcher(
				achievementsProvider,
				shortcutClans,
				this.games,
			),
		);

		const steamAjaxRequest = SteamAjaxRequest.getSteamAjaxRequest();

		if (isNil(steamAjaxRequest)) {
			logger.error(
				"[SessionPatches] window.steamAjaxRequest unavailable; shared-client redirects disabled.",
			);
		} else {
			this.scope.track(
				new SteamAjaxRequestPatcher(
					STEAM_AJAX_REDIRECT_ROUTES,
					steamAjaxRequest,
					shortcutClans,
					this.games,
				),
			);
		}

		this.scope.track(
			new SteamAxiosPatcher(AXIOS_REDIRECT_ROUTES, shortcutClans, this.games),
		);

		this.scope.track(
			new SteamFetchPatcher(FETCH_REDIRECT_ROUTES, shortcutClans, this.games),
		);

		this.scope.track(
			new SteamYourStuffAchievementsPatcher(achievementsProvider, this.games),
		);
	}
}
