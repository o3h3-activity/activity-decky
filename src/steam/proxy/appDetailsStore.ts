import type { AppDetails } from "@decky/ui/dist/globals/steam-client/App";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";

type AppDetailsStoreLike = {
	GetAppDetails(appId: number): Nullable<AppDetails>;
	RequestAppDetails(appId: number): Promise<Nullable<AppDetails>>;
};

export class SteamClient {
	public static async getAppDetails(
		appId: number,
	): Promise<Nullable<AppDetails>> {
		if (isNil(window.appDetailsStore)) {
			logger.debug(
				"[SteamClient][getAppDetails] `appDetailsStore` unavailable",
			);

			return undefined;
		}

		const store = window.appDetailsStore as unknown as AppDetailsStoreLike;

		return store.RequestAppDetails(appId);
	}
}
