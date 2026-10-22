import { readActivityUser } from "@steam/patches/activity/activityUser";
import type {
	GetFriendsGameplayInfoEntry,
	GetFriendsGameplayInfoResponse,
} from "@typings/friendsGameplay";
import type { ActivityFriend } from "@typings/virtualFriend";
import { isObjectLike } from "@utils/isObjectLike";
import { isNonNegativeSafeInteger } from "@utils/safeInteger";

/** Steam's gameplay body plus the Activity friends its `steamid`s must resolve to. */
export type FriendsGameplay = Readonly<{
	friends: readonly ActivityFriend[];
	info: GetFriendsGameplayInfoResponse;
}>;

type ParsedEntry = Readonly<{
	entry: GetFriendsGameplayInfoEntry;
	friend: ActivityFriend;
}>;

/**
 * Converts Activity playtime rows into Steam's friends-gameplay response.
 *
 * Steam separates friends into `played_recently` and `played_ever`. Each
 * entry needs a SteamID, recent `minutes_played`, and lifetime
 * `minutes_played_forever`. A friend with recent minutes goes in the first
 * list; other played friends go in the second. Malformed rows and friends
 * with no playtime are skipped. Categories we have no data for stay empty.
 *
 * The result also includes the matching Activity users so their names and
 * avatars can be registered before Steam renders the playtime lists.
 */
export abstract class FriendsGameplayResponse {
	public static parse(value: unknown): FriendsGameplay | undefined {
		if (!Array.isArray(value)) {
			return undefined;
		}

		const friends: ActivityFriend[] = [];
		const playedEver: GetFriendsGameplayInfoEntry[] = [];
		const playedRecently: GetFriendsGameplayInfoEntry[] = [];

		for (const item of value) {
			const parsed = FriendsGameplayResponse.readEntry(item);

			if (!parsed) {
				continue;
			}

			friends.push(parsed.friend);
			(parsed.entry.minutes_played > 0 ? playedRecently : playedEver).push(
				parsed.entry,
			);
		}

		return {
			friends,
			info: {
				in_game: [],
				in_wishlist: [],
				owns: [],
				played_ever: playedEver,
				played_recently: playedRecently,
			},
		};
	}

	private static readEntry(value: unknown): ParsedEntry | undefined {
		if (
			!isObjectLike(value) ||
			!("hasPlayed" in value) ||
			!("user" in value) ||
			!("minutesPlayedLastTwoWeeks" in value) ||
			!("minutesPlayedTotal" in value)
		) {
			return undefined;
		}

		const hasPlayed = value.hasPlayed;
		const user = readActivityUser(value.user);

		const total = FriendsGameplayResponse.readMinutes(value.minutesPlayedTotal);
		const recent = FriendsGameplayResponse.readMinutes(
			value.minutesPlayedLastTwoWeeks,
		);

		if (
			typeof hasPlayed !== "boolean" ||
			!hasPlayed ||
			!user ||
			total === undefined ||
			recent === undefined
		) {
			return undefined;
		}

		return {
			entry: {
				minutes_played: recent,
				minutes_played_forever: total,
				steamid: user.friend.steamId,
			},
			friend: user.friend,
		};
	}

	/** Anything but a non-negative safe integer is invalid. */
	private static readMinutes(value: unknown): number | undefined {
		return isNonNegativeSafeInteger(value) ? value : undefined;
	}
}
