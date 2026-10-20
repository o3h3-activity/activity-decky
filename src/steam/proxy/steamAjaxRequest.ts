import type { SteamAjaxRequest as SteamAjaxRequestType } from "@typings/steamAjaxRequest";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";

export class SteamAjaxRequest {
	public static getSteamAjaxRequest(): Nullable<SteamAjaxRequestType> {
		if (isNil(window?.steamAjaxRequest)) {
			logger.error("Can't access `steamAjaxRequest` from `window`.");

			return undefined;
		}

		return window.steamAjaxRequest;
	}
}
