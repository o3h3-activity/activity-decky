import { describe, expect, it } from "vitest";
import type { components } from "../../../../../../steam-deck-api";
import { UserNewsFeedParser } from "./userNewsFeedParser";

const AUTHOR = {
	avatarUrl: "https://example.com/ada.png",
	nickname: "Ada",
	userId: "a2d8be4d-2d8a-4e32-b37b-917d63f0c6d8",
};
const FRIENDS = [
	{
		hasPlayed: false,
		minutesPlayedLastTwoWeeks: 0,
		minutesPlayedTotal: 0,
		user: { ...AUTHOR, steamId: "76561197960287930" },
	},
];
const ACHIEVEMENT = {
	author: AUTHOR,
	earnedAt: "2026-10-01T23:59:59Z",
	id: "101",
	ownedByCurrentUser: false,
} satisfies components["schemas"]["ActivityAchievementResponse"];
const comment = (
	overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
	author: AUTHOR,
	body: "[b]Hello[/b]",
	bodyFormat: "steam-bbcode",
	createdAt: "2026-10-01T12:34:56.750Z",
	gameId: "11111111-1111-4111-8111-111111111111",
	id: "b2d8be4d-2d8a-4e32-b37b-917d63f0c6d8",
	ownedByCurrentUser: false,
	releaseId: "22222222-2222-4222-8222-222222222222",
	releaseRevisionId: "33333333-3333-4333-8333-333333333333",
	updatedAt: "2026-10-01T12:34:56.750Z",
	...overrides,
});
const EXPECTED = {
	actor: {
		avatarUrl: "https://example.com/ada.png",
		nickname: "Ada",
		steamId: "76561197960287930",
	},
	id: "b2d8be4d-2d8a-4e32-b37b-917d63f0c6d8",
	kind: "user_status",
	ownedByCurrentUser: false,
	rtime: 1_790_858_096,
	status_text: "[b]Hello[/b]",
};

describe("UserNewsFeedParser.parse", () => {
	it("converts activity comments using the author's real Steam identity even if they have not played", () => {
		expect(
			UserNewsFeedParser.parse(
				{ achievements: [], comments: [comment()] },
				FRIENDS,
			),
		).toEqual({
			events: [EXPECTED],
		});
	});

	it("uses the authenticated Steam identity for owned comments without a friend entry", () => {
		expect(
			UserNewsFeedParser.parse(
				{ achievements: [], comments: [comment({ ownedByCurrentUser: true })] },
				[],
				"76561197960287931",
			),
		).toEqual({
			events: [
				{
					...EXPECTED,
					actor: { ...EXPECTED.actor, steamId: "76561197960287931" },
					ownedByCurrentUser: true,
				},
			],
		});
	});

	it("skips malformed comments and unresolved authors without hiding valid comments", () => {
		expect(
			UserNewsFeedParser.parse(
				{
					achievements: [],
					comments: [
						comment({ author: { ...AUTHOR, userId: "unknown" } }),
						comment({ createdAt: "not-a-date" }),
						comment({ bodyFormat: "html" }),
						comment({ body: 42 }),
						comment({ ownedByCurrentUser: true }),
						comment(),
					],
				},
				FRIENDS,
			),
		).toEqual({ events: [EXPECTED] });
	});

	it("assigns stable distinct Steam post times to comments by the same author", () => {
		const parsed = UserNewsFeedParser.parse(
			{
				achievements: [],
				comments: [comment({ id: "z" }), comment({ id: "a" })],
			},
			FRIENDS,
		);

		expect(parsed?.events.map(({ id, rtime }) => ({ id, rtime }))).toEqual([
			{ id: "z", rtime: 1_790_858_097 },
			{ id: "a", rtime: 1_790_858_096 },
		]);
	});

	it("rejects invalid envelopes and accepts an empty activity result", () => {
		expect(UserNewsFeedParser.parse({ items: [] }, FRIENDS)).toBeUndefined();
		expect(
			UserNewsFeedParser.parse({ achievements: [], comments: {} }, FRIENDS),
		).toBeUndefined();

		expect(
			UserNewsFeedParser.parse({ achievements: {}, comments: [] }, FRIENDS),
		).toBeUndefined();

		expect(UserNewsFeedParser.parse({ comments: [] }, FRIENDS)).toBeUndefined();
		expect(
			UserNewsFeedParser.parse({ achievements: [], comments: [] }, FRIENDS),
		).toEqual({
			events: [],
		});
	});

	it("groups simultaneous unlocks per actor without moving them across midnight or merging separate days", () => {
		const owned = {
			...ACHIEVEMENT,
			author: { userId: "current-user", nickname: "Grace" },
			ownedByCurrentUser: true,
		};
		const parsed = UserNewsFeedParser.parse(
			{
				achievements: [
					ACHIEVEMENT,
					{ ...ACHIEVEMENT, id: "102" },
					owned,
					{ ...owned, id: "102" },
					{ ...ACHIEVEMENT, id: "103", earnedAt: "2026-10-02T23:59:59Z" },
					{ ...owned, id: "103", earnedAt: "2026-10-02T23:59:59Z" },
				],
				comments: [comment({ createdAt: "2026-10-01T23:59:59Z" })],
			},
			FRIENDS,
			"76561197960287931",
		);

		expect(
			parsed?.events.filter((event) => event.kind === "achievement_unlocked"),
		).toEqual([
			{
				actor: EXPECTED.actor,
				achievement_ids: ["101", "102"],
				id: expect.any(String),
				kind: "achievement_unlocked",
				ownedByCurrentUser: false,
				rtime: 1_790_899_199,
			},
			{
				actor: { nickname: "Grace", steamId: "76561197960287931" },
				achievement_ids: ["101", "102"],
				id: expect.any(String),
				kind: "achievement_unlocked",
				ownedByCurrentUser: true,
				rtime: 1_790_899_199,
			},
			{
				actor: EXPECTED.actor,
				achievement_ids: ["103"],
				id: expect.any(String),
				kind: "achievement_unlocked",
				ownedByCurrentUser: false,
				rtime: 1_790_985_599,
			},
			{
				actor: { nickname: "Grace", steamId: "76561197960287931" },
				achievement_ids: ["103"],
				id: expect.any(String),
				kind: "achievement_unlocked",
				ownedByCurrentUser: true,
				rtime: 1_790_985_599,
			},
		]);

		expect(
			parsed?.events.find((event) => event.kind === "user_status"),
		).toEqual({
			...EXPECTED,
			rtime: 1_790_899_199,
		});

		const refreshed = UserNewsFeedParser.parse(
			{
				achievements: [{ ...ACHIEVEMENT, id: "102" }, ACHIEVEMENT],
				comments: [],
			},
			FRIENDS,
		);

		expect(refreshed?.events[0]?.id).toBe(
			parsed?.events.find(
				(event) =>
					event.kind === "achievement_unlocked" &&
					event.actor.steamId === "76561197960287930" &&
					event.achievement_ids.includes("102"),
			)?.id,
		);
	});

	it.each([
		// oxlint-disable-next-line unicorn/no-null -- JSON arrays can contain null entries.
		null,
		{ ...ACHIEVEMENT, id: "" },
		{ ...ACHIEVEMENT, id: 101 },
		{ ...ACHIEVEMENT, earnedAt: "not-a-date" },
		{ ...ACHIEVEMENT, earnedAt: 123 },
		{ ...ACHIEVEMENT, ownedByCurrentUser: "false" },
		{ ...ACHIEVEMENT, author: { userId: "unknown" } },
		{ ...ACHIEVEMENT, ownedByCurrentUser: true },
	])(
		"skips an invalid or unresolved unlock without hiding valid feed entries: %j",
		(invalid) => {
			const parsed = UserNewsFeedParser.parse(
				{
					achievements: [invalid, ACHIEVEMENT],
					comments: [comment()],
				},
				FRIENDS,
			);

			expect(parsed?.events).toEqual([
				EXPECTED,
				{
					actor: EXPECTED.actor,
					achievement_ids: ["101"],
					id: expect.any(String),
					kind: "achievement_unlocked",
					ownedByCurrentUser: false,
					rtime: 1_790_899_199,
				},
			]);
		},
	);
});
