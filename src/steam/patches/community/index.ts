/* oxlint-disable no-warning-comments */

import type { RedirectRoute } from "@steam/patches/requests/requestPatcher";

/**
 * Matches the library's `appcommunityfeed/{appid}` request.
 *
 * Steam expects a body containing a `hub` array. We do not supply that data
 * yet: `resolve` returns `undefined` so the request patcher calls Steam.
 * Matching a supported shortcut here does not mean its feed is replaced.
 */
export class SteamCommunityRoute {
	static matchUrl(url: string): ReturnType<RedirectRoute["matchUrl"]> {
		const match = /\/appcommunityfeed\/(\d+)/u.exec(url);

		if (!match) {
			return { shouldBeRedirected: false };
		}

		return { shouldBeRedirected: true, appId: Number(match[1]) };
	}

	static async resolve(): Promise<undefined> {
		// eslint-disable-next-line sonarjs/todo-tag
		// TODO: Resolve community feed by release.
		return undefined;
	}
}
