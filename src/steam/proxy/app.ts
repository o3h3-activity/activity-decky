import logger from "@utils/logger";
import { isNil } from "es-toolkit";

export class App {
	public static getCurrentUserIdAsU64(): Nullable<string> {
		if (isNil(window?.App?.m_CurrentUser?.strSteamID)) {
			logger.error(
				"Can't access `strSteamID` from `window.App.m_CurrentUser.`.",
			);

			return undefined;
		}

		return window.App.m_CurrentUser.strSteamID;
	}
}
