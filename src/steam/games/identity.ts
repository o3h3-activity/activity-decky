import { getGameIdentities } from "@api/discIdentity";
import { SteamClient } from "@steam/proxy/appDetailsStore";
import { AppStore } from "@steam/proxy/appStore";
import {
	findGamePath,
	SUPPORTED_ROM_EXTENSIONS,
} from "@steam/utils/launchCommand";
import { isNil, withTimeout } from "es-toolkit";
import { DiscIdentity, type Game } from "./game";

/** Bounds one shortcut's details request, so a request Steam never answers cannot stall its caller. */
const APP_DETAILS_TIMEOUT_MS = 30_000;

/**
 * Rejects whenever Steam or the backend cannot answer, so callers can tell a failure,
 * worth asking about again, from a definitive answer.
 */
export class Identity {
	shortcutAppIds(): readonly number[] | undefined {
		return AppStore.getShortcutAppIds();
	}

	/** `undefined` when the shortcut launches no supported ROM. */
	async locate(appId: number): Promise<string | undefined> {
		const details = await withTimeout(
			async () => SteamClient.getAppDetails(appId),
			APP_DETAILS_TIMEOUT_MS,
		);

		if (isNil(details)) {
			throw new Error(`Steam has no details for shortcut ${appId}`);
		}

		const path = findGamePath(
			`${details.strShortcutExe} ${details.strShortcutLaunchOptions}`,
			{
				extensions: SUPPORTED_ROM_EXTENSIONS,
				startDir: details.strShortcutStartDir,
			},
		);

		return path ?? undefined;
	}

	/** Attaches each disc the backend identifies, in one batch; the others stay unidentified. */
	async identify(games: readonly Game[]): Promise<Game[]> {
		const results = await getGameIdentities(
			games.map((game) => game.toIdentityRequest()),
		);

		return games.map((game) => {
			const result = results.find(({ appId }) => appId === game.appId);

			return isNil(result)
				? game
				: game.identifiedAs(DiscIdentity.fromResult(result));
		});
	}
}
