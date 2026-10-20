import { afterPatch, callOriginal, replacePatch } from "@decky/ui";
import {
	EAppType,
	type SteamAppOverview,
} from "@decky/ui/dist/globals/steam-client/App";
import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import { AppStore } from "@steam/proxy/appStore";
import type { AppOverviewPrototype } from "@typings/appStore";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";

/** Shortcut game ids pack the app id in the low 12 bits (0xFFF). */
const SHORTCUT_APP_ID_MASK = 4095;

/**
 * Unlocks the native app-details tabs for targeted shortcuts.
 *
 * Investigation summary (steam/chunk.js):
 *
 * - The Deck UI app page (module 87498) renders four tabs — Activity
 *   ("WhatsNew"), Your stuff ("YourStuff"), Community and Game info. Their
 *   content is driven by a section set produced by `GetSections` (module
 *   59856, exported as `N_`):
 *
 *       e.app_type == Demo || e.app_type == MobileApp ? s = mobileList
 *       : e.BIsModOrShortcut() && (s = ["nonsteam", "notes", "screenshots"]);
 *
 *   So every shortcut is hard-limited to three sections; the Activity,
 *   Community, cards and game-info sections never appear.
 *
 * - `BIsModOrShortcut()` lives on the AppOverview prototype (module 71047,
 *   instance reachable through the `window.appStore` global):
 *
 *       BIsModOrShortcut() { return this.third_party_mod || this.app_type == Shortcut; }
 *       BIsShortcut()      { return this.app_type == Shortcut; }
 *       GetGameID()        { return this.BIsModOrShortcut() ? this.m_gameid : this.appid.toString(); }
 *       GetPrimaryAppID()  { return this.BIsModOrShortcut() ? 4095 & this.m_ulGameId.low : this.appid; }
 *
 *   This is why editing `app_type` to 1 breaks the Play button: the launcher
 *   resolves the game through `GetGameID()`/`GetPrimaryAppID()` and gets the
 *   generated shortcut appid instead of the real 64-bit shortcut gameid.
 *
 * The patch makes `BIsModOrShortcut()` report `false` for targeted shortcuts
 * (unlocking every `BIsModOrShortcut()`-gated UI path: sections, game-info
 * description/association reads, store/community widgets) while pinning
 * `GetGameID()`/`GetPrimaryAppID()` to the shortcut branch based on
 * `app_type` — which we never touch — so launching keeps working.
 */
export class OverviewPatch {
	readonly name = "Overview";

	readonly installed: boolean;

	private readonly scope = new LifetimeScope("Overview");

	constructor(private readonly games: Games) {
		try {
			this.installed = this.mount();
		} catch (error: unknown) {
			this.unMount();

			throw error;
		}
	}

	private mount(): boolean {
		const appOverviewProto = OverviewPatch.getAppOverviewProto();

		if (isNil(appOverviewProto)) {
			return false;
		}

		this.patchBIsModOrShortcut(appOverviewProto);
		this.patchGetGameID(appOverviewProto);
		this.patchGetPrimaryAppID(appOverviewProto);

		return true;
	}

	public static getAppOverviewProto(): Nullable<AppOverviewPrototype> {
		const anyAvailableAppOverview = AppStore.getAnyAvailableAppOverview();

		if (isNil(anyAvailableAppOverview)) {
			return undefined;
		}

		const proto = Object.getPrototypeOf(
			anyAvailableAppOverview,
		) as null | Partial<AppOverviewPrototype>;

		if (isNil(proto)) {
			return undefined;
		}

		const missingMethods = [
			["BIsModOrShortcut", proto.BIsModOrShortcut],
			["GetGameID", proto.GetGameID],
			["GetPrimaryAppID", proto.GetPrimaryAppID],
		].flatMap(([method, value]) =>
			typeof value === "function" ? [] : [method],
		);

		if (missingMethods.length > 0) {
			return undefined;
		}

		logger.debug(
			`\`AppOverview\` proto located. AppId used: \`${anyAvailableAppOverview.appid}\`.`,
		);

		return proto as AppOverviewPrototype;
	}

	private patchBIsModOrShortcut(proto: AppOverviewPrototype): void {
		const games = this.games;

		this.scope.add(
			replacePatch(
				proto,
				"BIsModOrShortcut",
				function (this: SteamAppOverview) {
					if (
						this.app_type === EAppType.Shortcut &&
						games.isSupported(this.appid)
					) {
						logger.once.info(
							`[replacePatch][BIsModOrShortcut] Disable \`BIsModOrShortcut\` for \`${this.display_name}\` (${this.appid})`,
						);

						return false;
					}

					return callOriginal;
				},
			),
		);
	}

	private patchGetGameID(proto: AppOverviewPrototype): void {
		const games = this.games;

		this.scope.add(
			afterPatch(
				proto,
				"GetGameID",
				function (this: SteamAppOverview, _args: unknown[], ret: unknown) {
					if (
						this.app_type === EAppType.Shortcut &&
						games.isSupported(this.appid) &&
						this.m_gameid !== undefined
					) {
						logger.once.debug(
							`[afterPatch][GetGameID] GetGameID pinned to shortcut gameid for appid=${this.appid}: ${this.m_gameid}`,
						);

						return this.m_gameid;
					}

					return ret;
				},
			),
		);
	}

	private patchGetPrimaryAppID(proto: AppOverviewPrototype): void {
		const games = this.games;

		this.scope.add(
			replacePatch(proto, "GetPrimaryAppID", function (this: SteamAppOverview) {
				if (
					this.app_type === EAppType.Shortcut &&
					games.isSupported(this.appid) &&
					this.m_ulGameId
				) {
					return SHORTCUT_APP_ID_MASK & this.m_ulGameId.low;
				}

				return callOriginal;
			}),
		);
	}

	unMount(): void {
		this.scope.unMount();
	}
}
