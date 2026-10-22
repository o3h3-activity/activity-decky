/* oxlint-disable no-warning-comments */

import type { RedirectRoute } from "@steam/patches/requests/requestPatcher";

/**
 * Matches the `libraryappdetails` request used by Steam's game-info view.
 *
 * The numeric `appid` query parameter is needed for the shortcut support
 * check. There is no replacement details source yet, so `resolve` returns
 * `undefined` and Steam handles the request. This is not an empty-details
 * response: Steam's own loader still decides whether the request succeeded.
 */
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
