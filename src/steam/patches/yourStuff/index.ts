/* oxlint-disable no-warning-comments */

import type { RedirectRoute } from "@steam/patches/requests/requestPatcher";

/**
 * Matches `ajaxgetbadgeinfo/{appid}` requests from Your Stuff.
 *
 * Steam reads card and badge fields from `response.badgedata`. We do not
 * provide a replacement badge response yet, so `undefined` tells the
 * request patcher to call Steam, even for a supported shortcut.
 */
export class SteamYourStuffRoute {
	static matchUrl(url: string): ReturnType<RedirectRoute["matchUrl"]> {
		const match = /ajaxgetbadgeinfo\/(\d+)/u.exec(url);

		if (!match) {
			return { shouldBeRedirected: false };
		}

		return { shouldBeRedirected: true, appId: Number(match[1]) };
	}

	static async resolve(): Promise<undefined> {
		// eslint-disable-next-line sonarjs/todo-tag
		// TODO: Resolve badge details by release.
		return undefined;
	}
}
