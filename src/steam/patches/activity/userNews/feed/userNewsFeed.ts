import { getActivityUser } from "@api/account";
import { getActivity, getFriendsGameplay } from "@api/activity";
import { type GameRelease, hasActivityIdentifiers } from "@steam/games/game";
import type { ParsedUserNewsFeed } from "@typings/userNews";
import logger from "@utils/logger";
import type { UserNewsRequest } from "../events/types";
import { UserNewsFeedParser } from "./userNewsFeedParser";

/**
 * Loads the data needed to build a shortcut's UserNews response.
 *
 * The feed alone is not enough: its author IDs need to be matched to SteamIDs
 * using the friend list and current account. These are fetched together, then
 * passed to `UserNewsFeedParser`. A missing or invalid feed returns
 * `undefined` so the RPC patch can fall back to Steam.
 *
 * The abort check after loading prevents a completed request from supplying
 * data to a session that has already ended.
 */
export abstract class UserNewsFeed {
	public static async load(
		release: GameRelease,
		request: UserNewsRequest,
		signal: AbortSignal,
	): Promise<ParsedUserNewsFeed | undefined> {
		if (!hasActivityIdentifiers(release) || signal.aborted) {
			return undefined;
		}

		const identifiers = [
			release.gameId,
			release.releaseId,
			release.revisionId,
		] as const;
		const [result, friends, currentUser] = await Promise.all([
			getActivity(...identifiers),
			getFriendsGameplay(...identifiers),
			getActivityUser(),
		]);

		if (signal.aborted) {
			return undefined;
		}

		if (!result.ok) {
			logger.error("[UserNews] Feed fetch failed.", {
				appId: request.appId,
				error: result.error,
				status: result.status,
			});

			return undefined;
		}

		const feed = UserNewsFeedParser.parse(
			result.data,
			friends.ok ? friends.data : undefined,
			currentUser?.steamId,
		);

		if (!feed) {
			logger.error("[UserNews] Invalid feed response.", {
				appId: request.appId,
			});
		}

		return feed;
	}
}
