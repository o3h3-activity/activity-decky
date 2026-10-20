/* oxlint-disable no-warning-comments */

import type { RedirectRoute } from "@steam/patches/requests/requestPatcher";

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
