import type { AppAchievement } from "@decky/ui/dist/globals/steam-client/App";
import type {
	AchievementsProvider,
	MappedAchievements,
} from "@steam/achievements/achievementsProvider";
import { getAccountId } from "@steam/patches/activity/steamId";
import type { PlatformAchievement } from "@typings/achievements";
import type { SteamAppActivity } from "@typings/appActivityStore";
import type { UserNewsEvent } from "@typings/userNews";
import type {
	SteamUserNewsProtoEvent,
	SteamUserNewsProtoEventConstructor,
} from "@typings/userNewsService";
import { isObjectLike } from "@utils/isObjectLike";
import { describe, expect, it, vi } from "vitest";
import { AchievementUnlockedUserNewsEventHandler } from "./achievementUnlocked";
import { PlayedFirstTimeUserNewsEventHandler } from "./playedFirstTime";
import { ReceivedNewGameUserNewsEventHandler } from "./receivedNewGame";
import type { UserNewsEventContext } from "./types";
import { UserStatusUserNewsEventHandler } from "./userStatus";

const ACTOR = { nickname: "Ada", steamId: "76561197960287930" };
const APP_ID = 42;
const proto: SteamUserNewsProtoEventConstructor = {
	fromObject: (fields) =>
		({
			fields,
			serializeBinary: () => new Uint8Array(),
		}) as unknown as SteamUserNewsProtoEvent,
	prototype: {},
};

function createContext(): UserNewsEventContext {
	return {
		activity: { m_AchievementMap: new Map() } as unknown as SteamAppActivity,
		appId: APP_ID,
		gameId: "42",
		proto,
	};
}

function fieldsOf(event: unknown): object {
	if (
		!isObjectLike(event) ||
		!("fields" in event) ||
		!isObjectLike(event.fields)
	) {
		throw new TypeError("Expected fake proto fields.");
	}

	return event.fields;
}

describe("user news feed event handlers", () => {
	it("attributes played-first-time events to the Activity actor", async () => {
		const result =
			await new PlayedFirstTimeUserNewsEventHandler().createFromFeed(
				[
					{
						actor: ACTOR,
						id: "first",
						kind: "played_first_time",
						ownedByCurrentUser: false,
						rtime: 10,
					},
				],
				createContext(),
			);

		expect(fieldsOf(result?.[0]?.event)).toMatchObject({
			eventtime: 10,
			eventtype: 30,
			steamid_actor: ACTOR.steamId,
		});
	});

	it("uses only the context app for received-game events", async () => {
		const result =
			await new ReceivedNewGameUserNewsEventHandler().createFromFeed(
				[
					{
						actor: ACTOR,
						id: "received",
						kind: "received_new_game",
						ownedByCurrentUser: false,
						rtime: 30,
					},
				],
				createContext(),
			);

		expect(fieldsOf(result?.[0]?.event)).toMatchObject({
			appids: [APP_ID],
			steamid_actor: ACTOR.steamId,
		});
	});

	it("registers all comments with their Activity ownership", async () => {
		const register = vi.fn<(input: unknown) => void>();
		const result = await new UserStatusUserNewsEventHandler({
			register,
		} as never).createFromFeed(
			[
				{
					actor: ACTOR,
					id: "comment",
					kind: "user_status",
					ownedByCurrentUser: false,
					rtime: 40,
					status_text: "hi",
				},
			],
			createContext(),
		);

		expect(register).toHaveBeenCalledWith({
			accountId: getAccountId(BigInt(ACTOR.steamId)),
			appId: APP_ID,
			commentId: "comment",
			ownedByCurrentUser: false,
			postId: "40",
			statusText: "hi",
			steamId: ACTOR.steamId,
		});

		expect(fieldsOf(result?.[0]?.event)).toMatchObject({
			steamid_actor: ACTOR.steamId,
		});
	});

	it("defers achievement conversion until RetroAchievements metadata is available", async () => {
		const achievement: PlatformAchievement = {
			achieved: true,
			description: "d",
			global_percent: 5,
			hidden: false,
			icon: "i",
			id: "1",
			name: "A",
			unlock_time: 1,
			unlocked_icon: "u",
		};
		const provider = {
			getAchievements: vi
				.fn<(appId: number) => Promise<MappedAchievements | undefined>>()
				.mockResolvedValueOnce(undefined)
				.mockResolvedValueOnce({
					details: {
						nAchieved: 1,
						nTotal: 1,
						vecAchievedHidden: [],
						vecHighlight: [],
						vecUnachieved: [],
					},
					platformAchievements: [achievement],
					platformAchievementsById: new Map([[achievement.id, achievement]]),
					rgAchievements: [],
				}),
		} as unknown as AchievementsProvider;
		const context = createContext();
		const achievementMap = context.activity.m_AchievementMap;
		const existing = new Map<string, AppAchievement>();

		achievementMap.set(APP_ID, existing);

		const handler = new AchievementUnlockedUserNewsEventHandler(provider);
		const events: UserNewsEvent[] = [
			{
				actor: ACTOR,
				achievement_ids: ["1"],
				id: "achievement",
				kind: "achievement_unlocked",
				ownedByCurrentUser: false,
				rtime: 50,
			},
		];

		await expect(
			handler.createFromFeed(events, context),
		).resolves.toBeUndefined();

		expect(achievementMap.get(APP_ID)).toBe(existing);

		const result = await handler.createFromFeed(events, context);

		expect(fieldsOf(result?.[0]?.event)).toMatchObject({
			achievement_names: ["1"],
			steamid_actor: ACTOR.steamId,
		});

		expect(achievementMap.get(APP_ID)?.get("1")).toMatchObject({
			strID: "1",
		});
	});

	it("does not require metadata when the feed has no achievement events", async () => {
		const getAchievements = vi.fn<(appId: number) => Promise<undefined>>();
		const provider = { getAchievements } as unknown as AchievementsProvider;

		await expect(
			new AchievementUnlockedUserNewsEventHandler(provider).createFromFeed(
				[],
				createContext(),
			),
		).resolves.toEqual([]);

		expect(getAchievements).not.toHaveBeenCalled();
	});

	it.each([
		{ unlockedIcon: "u", expectedImage: "u" },
		{ unlockedIcon: undefined, expectedImage: "i" },
		{ unlockedIcon: "", expectedImage: "" },
	])(
		"maps known Achievement ids with artwork $unlockedIcon and skips unavailable ids",
		async ({ unlockedIcon, expectedImage }) => {
			const achievement: PlatformAchievement = {
				achieved: false,
				description: "d",
				global_percent: 5,
				hidden: false,
				icon: "i",
				id: "1",
				name: "A",
				unlock_time: 1,
				unlocked_icon: unlockedIcon,
			};
			const provider = {
				getAchievements: () =>
					Promise.resolve({
						details: {
							nAchieved: 0,
							nTotal: 1,
							vecAchievedHidden: [],
							vecHighlight: [],
							vecUnachieved: [],
						},
						platformAchievements: [achievement],
						platformAchievementsById: new Map([[achievement.id, achievement]]),
						rgAchievements: [],
					}),
			} as unknown as AchievementsProvider;
			const events: UserNewsEvent[] = [
				{
					actor: ACTOR,
					achievement_ids: ["1", "missing"],
					id: "achievement",
					kind: "achievement_unlocked",
					ownedByCurrentUser: false,
					rtime: 50,
				},
			];
			const context = createContext();
			const result = await new AchievementUnlockedUserNewsEventHandler(
				provider,
			).createFromFeed(events, context);

			expect(fieldsOf(result?.[0]?.event)).toMatchObject({
				achievement_names: ["1"],
				steamid_actor: ACTOR.steamId,
			});

			expect(
				context.activity.m_AchievementMap.get(APP_ID)?.get("1"),
			).toMatchObject({
				bAchieved: true,
				rtUnlocked: 0,
				strImage: expectedImage,
			});
		},
	);
});
