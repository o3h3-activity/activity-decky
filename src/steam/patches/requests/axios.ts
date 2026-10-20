import { findModule } from "@decky/ui";
import type { Games } from "@steam/games";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import type { SteamAjaxRequestConfig } from "@typings/steamAjaxRequest";
import { isObjectLike } from "@utils/isObjectLike";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";
import { type RedirectRoute, SteamRequestPatcher } from "./requestPatcher";

type AxiosLike = {
	CancelToken: unknown;
	create: unknown;
	defaults: unknown;
	get: (url: string, config?: SteamAjaxRequestConfig) => Promise<unknown>;
	isCancel: unknown;
	post: unknown;
};

function isAxiosLike(value: unknown): value is AxiosLike {
	if (
		value === null ||
		(typeof value !== "function" && typeof value !== "object")
	) {
		return false;
	}

	const candidate = value as {
		CancelToken?: unknown;
		create?: unknown;
		defaults?: unknown;
		get?: unknown;
		isCancel?: unknown;
		post?: unknown;
	};

	return (
		typeof candidate.get === "function" &&
		typeof candidate.post === "function" &&
		typeof candidate.create === "function" &&
		typeof candidate.isCancel === "function" &&
		isObjectLike(candidate.defaults) &&
		(typeof candidate.CancelToken === "function" ||
			typeof candidate.CancelToken === "object") &&
		candidate.CancelToken !== null
	);
}

export class SteamAxiosPatcher extends SteamRequestPatcher {
	constructor(
		routes: readonly RedirectRoute[],
		shortcutClans: ShortcutClanRegistry,
		games: Games,
	) {
		super(routes, "SteamAxiosPatcher", shortcutClans, games);

		this.patchAxios();
	}

	private patchAxios(): void {
		const axios = findModule(isAxiosLike) as AxiosLike | undefined;

		if (isNil(axios)) {
			logger.error(`[${this.owner}] axios module not found`);

			return;
		}

		logger.debug(`[${this.owner}] axios module found. Patching get.`);

		this.patchGet(axios, (data, config) => ({
			config,
			data,
			headers: {},
			status: 200,
			statusText: "OK",
		}));
	}
}
