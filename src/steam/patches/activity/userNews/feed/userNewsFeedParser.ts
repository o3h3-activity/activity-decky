import { readActivityUser } from "@steam/patches/activity/activityUser";
import type {
	AchievementUnlockedUserNewsEvent,
	ParsedUserNewsFeed,
	UserNewsEvent,
	UserStatusUserNewsEvent,
} from "@typings/userNews";
import type { ActivityFriend } from "@typings/virtualFriend";
import { isObjectLike } from "@utils/isObjectLike";

const MILLISECONDS_PER_SECOND = 1000;

/**
 * Turns Activity comments and achievement unlocks into events the Steam
 * handlers can encode.
 *
 * Authors are matched to SteamIDs through the friend list, or the current
 * account for our own posts. Comments must use `steam-bbcode`; malformed
 * entries and authors that cannot be resolved are skipped.
 *
 * Steam uses a status event's timestamp as its post ID. Comments by the same
 * author therefore need distinct timestamps: collisions are moved forward
 * one second at a time. Achievement unlocks work differently; unlocks by
 * the same author in the same second are grouped into one event.
 */
export abstract class UserNewsFeedParser {
	public static parse(
		value: unknown,
		friends: unknown,
		currentUserSteamId?: null | string,
	): ParsedUserNewsFeed | undefined {
		if (
			!isObjectLike(value) ||
			!("comments" in value) ||
			!Array.isArray(value.comments) ||
			!("achievements" in value) ||
			!Array.isArray(value.achievements)
		) {
			return undefined;
		}

		const steamIds = new Map<string, string>();

		if (Array.isArray(friends)) {
			for (const entry of friends) {
				if (!isObjectLike(entry) || !("user" in entry)) {
					continue;
				}

				const user = readActivityUser(entry.user);

				if (user) {
					steamIds.set(user.userId, user.friend.steamId);
				}
			}
		}

		const events: UserNewsEvent[] = value.comments.flatMap((comment) => {
			const event = UserNewsFeedParser.normalizeComment(
				comment,
				steamIds,
				currentUserSteamId,
			);

			return event ? [event] : [];
		});

		UserNewsFeedParser.deduplicateEventTimes(events);
		const achievementGroups = new Map<
			string,
			AchievementUnlockedUserNewsEvent
		>();

		for (const achievement of value.achievements) {
			const event = UserNewsFeedParser.normalizeAchievement(
				achievement,
				steamIds,
				currentUserSteamId,
			);

			if (!event) {
				continue;
			}

			const group = achievementGroups.get(event.id);

			if (group) {
				group.achievement_ids.push(...event.achievement_ids);
			} else {
				achievementGroups.set(event.id, event);
				events.push(event);
			}
		}

		return { events };
	}

	private static normalizeComment(
		value: unknown,
		steamIds: ReadonlyMap<string, string>,
		currentUserSteamId?: null | string,
	): undefined | UserStatusUserNewsEvent {
		if (
			!isObjectLike(value) ||
			!("id" in value) ||
			typeof value.id !== "string" ||
			value.id.length === 0 ||
			!("createdAt" in value) ||
			typeof value.createdAt !== "string" ||
			!("ownedByCurrentUser" in value) ||
			typeof value.ownedByCurrentUser !== "boolean" ||
			!("body" in value) ||
			typeof value.body !== "string" ||
			!("bodyFormat" in value) ||
			value.bodyFormat !== "steam-bbcode" ||
			!("author" in value)
		) {
			return undefined;
		}

		const actor = UserNewsFeedParser.readAuthor(
			value.author,
			value.ownedByCurrentUser,
			steamIds,
			currentUserSteamId,
		);
		const occurredAt = Date.parse(value.createdAt);
		const rtime = Math.floor(occurredAt / MILLISECONDS_PER_SECOND);

		return actor && !Number.isNaN(occurredAt) && Number.isSafeInteger(rtime)
			? {
					actor,
					id: value.id,
					kind: "user_status",
					ownedByCurrentUser: value.ownedByCurrentUser,
					rtime,
					status_text: value.body,
				}
			: undefined;
	}

	private static normalizeAchievement(
		value: unknown,
		steamIds: ReadonlyMap<string, string>,
		currentUserSteamId?: null | string,
	): AchievementUnlockedUserNewsEvent | undefined {
		if (
			!isObjectLike(value) ||
			!("id" in value) ||
			typeof value.id !== "string" ||
			value.id.length === 0 ||
			!("earnedAt" in value) ||
			typeof value.earnedAt !== "string" ||
			!("ownedByCurrentUser" in value) ||
			typeof value.ownedByCurrentUser !== "boolean" ||
			!("author" in value)
		) {
			return undefined;
		}

		const actor = UserNewsFeedParser.readAuthor(
			value.author,
			value.ownedByCurrentUser,
			steamIds,
			currentUserSteamId,
		);
		const rtime = Math.floor(
			Date.parse(value.earnedAt) / MILLISECONDS_PER_SECOND,
		);

		return actor && Number.isSafeInteger(rtime)
			? {
					actor,
					achievement_ids: [value.id],
					id: `achievement:${actor.steamId}:${rtime}`,
					kind: "achievement_unlocked",
					ownedByCurrentUser: value.ownedByCurrentUser,
					rtime,
				}
			: undefined;
	}

	private static readAuthor(
		author: unknown,
		ownedByCurrentUser: boolean,
		steamIds: ReadonlyMap<string, string>,
		currentUserSteamId?: null | string,
	): ActivityFriend | undefined {
		if (
			!isObjectLike(author) ||
			!("userId" in author) ||
			typeof author.userId !== "string"
		) {
			return undefined;
		}

		const steamId = ownedByCurrentUser
			? currentUserSteamId
			: steamIds.get(author.userId);

		return readActivityUser({ ...author, steamId })?.friend;
	}

	private static deduplicateEventTimes(events: UserNewsEvent[]): void {
		const eventsByActor = new Map<string, UserNewsEvent[]>();

		for (const event of events) {
			const actorEvents = eventsByActor.get(event.actor.steamId) ?? [];

			actorEvents.push(event);
			eventsByActor.set(event.actor.steamId, actorEvents);
		}

		for (const actorEvents of eventsByActor.values()) {
			const usedTimes = new Set<number>();

			actorEvents.sort(
				(left, right) =>
					left.rtime - right.rtime || left.id.localeCompare(right.id),
			);

			for (const event of actorEvents) {
				while (usedTimes.has(event.rtime)) {
					event.rtime += 1;
				}

				usedTimes.add(event.rtime);
			}
		}
	}
}
