/* oxlint-disable no-warning-comments */

import type { RedirectRoute } from "@steam/patches/requests/requestPatcher";

export class SteamGameInfoRoute {
	static matchUrl(url: string): ReturnType<RedirectRoute["matchUrl"]> {
		if (!url.includes("libraryappdetails")) {
			return { shouldBeRedirected: false };
		}

		const { searchParams } = new URL(url, "https://steamcommunity.com");
		const rawAppid = searchParams.get("appid");

		if (!rawAppid || !/^\d+$/u.test(rawAppid)) {
			return { shouldBeRedirected: false };
		}

		return { shouldBeRedirected: true, appId: Number(rawAppid) };
	}

	static async resolve(): Promise<undefined> {
		// eslint-disable-next-line sonarjs/todo-tag
		// TODO: Resolve game details by release.
		return undefined;
	}
}
