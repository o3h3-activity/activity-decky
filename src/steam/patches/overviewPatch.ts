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

/** Steam's shortcut `GetPrimaryAppID` mask, not the local shortcut appid. */
const SHORTCUT_APP_ID_MASK = 4095;

/**
 * Opens the normal app-details sections for supported shortcuts.
 *
 * Steam's `GetSections` limits mods and shortcuts to "nonsteam", "notes",
 * and "screenshots". Returning false from `BIsModOrShortcut()` lets a
 * supported shortcut use the normal section list. Other patches supply
 * the data those sections need.
 *
 * Changing that check also affects launch IDs. `GetGameID()` would return
 * the appid instead of the shortcut's 64-bit `m_gameid`, which Steam passes
 * to `RunGame`. `GetPrimaryAppID()` would likewise stop extracting
 * `m_ulGameId.low & 4095`. Both methods are patched to keep their shortcut
 * behavior, using the unchanged `app_type` to identify shortcuts.
 *
 * These hooks live on the overview prototype and check `Games` support on
 * each call. Other apps keep their original behavior. `BIsShortcut()` is
 * left alone, but every caller of `BIsModOrShortcut()` sees the new result,
 * including the checks before loading game descriptions and associations.
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
