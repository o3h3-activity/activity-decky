import { callOriginal, replacePatch } from "@decky/ui";
import { LifetimeScope } from "@steam/lifetimeScope";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import { ClanImageHelper } from "@steam/proxy/clanImageHelper";
import { isObjectLike } from "@utils/isObjectLike";
import logger from "@utils/logger";
import { SAMPLE_EVENT_CAPSULE } from "./eventImages";

function clanAccountIdFromImageArg(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (isObjectLike(value) && "GetAccountID" in value) {
		const getAccountID = value.GetAccountID;

		if (typeof getAccountID === "function") {
			const accountId: unknown = getAccountID.call(value);

			if (typeof accountId === "number" && Number.isFinite(accountId)) {
				return accountId;
			}
		}
	}

	return undefined;
}

/**
 * Replaces image URLs for registered shortcut clans with the fallback capsule.
 *
 * Steam builds clan image URLs from an account ID and an image hash. Our
 * synthetic clans have no images on that CDN. Both `GenerateURLFromHashAndExt`
 * and `GenerateURLFromHashAndExtAndLang` are patched because callers use both.
 *
 * The first argument can be a numeric account ID or a SteamID object. After
 * extracting the account ID, we rewrite only clans in the shared registry.
 * Other image requests keep Steam's URL.
 */
export class ShortcutClanImagePatch {
	private readonly scope = new LifetimeScope("ShortcutClanImage");

	constructor(private readonly shortcutClans: ShortcutClanRegistry) {
		try {
			this.installPatches();
		} catch (error: unknown) {
			this.unMount();
			logger.error("[ShortcutClanImage] Failed to install patches", error);
		}
	}

	unMount(): void {
		this.scope.unMount();
	}

	private installPatches(): void {
		const helper = ClanImageHelper.getClanImageHelper();

		if (!helper) {
			logger.error("[ShortcutClanImage] Clan image helper not found.");

			return;
		}

		const rewrite = (args: unknown[]): unknown => {
			const clanAccountId = clanAccountIdFromImageArg(args[0]);

			if (
				clanAccountId !== undefined &&
				this.shortcutClans.has(clanAccountId)
			) {
				return SAMPLE_EVENT_CAPSULE;
			}

			return callOriginal;
		};

		this.scope.add(replacePatch(helper, "GenerateURLFromHashAndExt", rewrite));
		this.scope.add(
			replacePatch(helper, "GenerateURLFromHashAndExtAndLang", rewrite),
		);
	}
}
