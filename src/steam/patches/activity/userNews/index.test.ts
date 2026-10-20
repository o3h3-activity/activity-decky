import type { callOriginal, findModuleExport, replacePatch } from "@decky/ui";
import type {
	AchievementsProvider,
	MappedAchievements,
} from "@steam/achievements/achievementsProvider";
import type { Games } from "@steam/games";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import type { AppStore } from "@steam/proxy/appStore";
import type { QueryClient } from "@steam/proxy/queryClient";
import type { StoreItemCache } from "@steam/proxy/storeItemCache";
import type { UserNewsService } from "@steam/proxy/userNewsService";
import type { SteamAppActivity } from "@typings/appActivityStore";
import type { SteamQueryClient } from "@typings/queryClient";
import { isObjectLike } from "@utils/isObjectLike";
import type logger from "@utils/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UserStatusPatcher } from "../userStatus";
import {
	type RegisteredUserStatus,
	UserStatusRegistry,
} from "../userStatus/statusRegistry";
import type { VirtualFriendPatcher } from "../virtualFriends";

type DeckyUiModule = {
	callOriginal: typeof callOriginal;
	findModuleExport: typeof findModuleExport;
	replacePatch: typeof replacePatch;
	sleep: () => Promise<void>;
};
type AppStoreModule = { AppStore: typeof AppStore };
type StoreItemCacheModule = { StoreItemCache: typeof StoreItemCache };
type QueryClientModule = { QueryClient: typeof QueryClient };
type UserNewsServiceModule = { UserNewsService: typeof UserNewsService };
type LoggerModule = { default: typeof logger };
type PatchCallback = (args: unknown[]) => unknown;

const mocks = vi.hoisted(() => {
	const callbacks = new Map<string, PatchCallback>();
	const service = {
		GetAppDetailsSpotlight: vi.fn<() => unknown>(),
		GetUserNews: vi.fn<() => unknown>(),
	};
	const cache = {
		QueueStoreItemRequest: vi.fn<() => unknown>(),
		m_mapApps: new Map(),
	};

	return {
		cache,
		callbacks,
		callOriginal: Symbol("callOriginal"),
		gameActivityService: { GetActivity: vi.fn<() => unknown>() },
		getAchievements: vi.fn<() => Promise<MappedAchievements | undefined>>(),
		getActivity: vi.fn<() => Promise<unknown>>(),
		getFriendsGameplay: vi.fn<() => Promise<unknown>>(),
		getRelease: vi.fn<(appId: number) => Promise<unknown>>(),
		isAppShortcut: vi.fn<(appId: number) => boolean>(() => true),
		isSupported: vi.fn<(appId: number) => boolean>(() => false),
		queryClient: undefined as SteamQueryClient | undefined,
		proto: {
			fromObject: (fields: Record<string, unknown>) => ({
				fields,
				serializeBinary: () => new Uint8Array(),
			}),
			prototype: {},
		},
		registerClan: vi.fn<(appId: number) => void>(),
		service,
		unpatch: vi.fn<() => void>(),
	};
});

vi.mock(
	import("@api/account"),
	() =>
		({
			getActivityUser: async () => ({ steamId: "76561197960287930" }),
		}) as never,
);

vi.mock(
	import("@api/activity"),
	() =>
		({
			getActivity: mocks.getActivity,
			getFriendsGameplay: mocks.getFriendsGameplay,
		}) as never,
);

vi.mock(
	import("@decky/ui"),
	() =>
		({
			callOriginal: mocks.callOriginal,
			findModuleExport: vi.fn<typeof findModuleExport>(),
			replacePatch: vi.fn<
				(
					target: unknown,
					method: string,
					callback: PatchCallback,
				) => {
					original: () => string;
					unpatch: () => void;
				}
			>((_target: unknown, method: string, callback: PatchCallback) => {
				mocks.callbacks.set(method, callback);

				return {
					original: vi.fn<() => string>(() => "native-response"),
					unpatch: mocks.unpatch,
				};
			}),
			sleep: vi.fn<() => Promise<void>>(() => Promise.resolve()),
		}) as unknown as DeckyUiModule,
);

vi.mock(
	import("@decky/api"),
	() =>
		({
			addEventListener: vi.fn<() => void>(),
			callable: vi.fn<() => () => Promise<unknown>>(() =>
				vi.fn<() => Promise<unknown>>(),
			),
			removeEventListener: vi.fn<() => void>(),
		}) as never,
);

vi.mock(
	import("@steam/proxy/appStore"),
	() =>
		({
			AppStore: {
				isAppShortcut: mocks.isAppShortcut,
				getAppOverviewByAppID: () => ({
					display_name: "Fixture Game",
					visible_in_game_list: true,
				}),
			},
		}) as unknown as AppStoreModule,
);

vi.mock(
	import("@steam/proxy/storeItemCache"),
	() =>
		({
			StoreItemCache: {
				getStoreItemCache: vi.fn<() => typeof mocks.cache>(() => mocks.cache),
			},
		}) as unknown as StoreItemCacheModule,
);

vi.mock(
	import("@steam/proxy/queryClient"),
	() =>
		({
			QueryClient: {
				getQueryClient: () => mocks.queryClient as unknown as SteamQueryClient,
			},
		}) as unknown as QueryClientModule,
);

vi.mock(
	import("@steam/proxy/userNewsService"),
	() =>
		({
			UserNewsService: {
				getUserGameActivityService: () => mocks.gameActivityService,
				getProtoEventConstructor: () => mocks.proto,
				getUserNewsService: vi.fn<() => typeof mocks.service>(
					() => mocks.service,
				),
			},
		}) as unknown as UserNewsServiceModule,
);

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: { error: vi.fn<(...args: unknown[]) => void>() },
		}) as unknown as LoggerModule,
);

import { SteamUserNewsPatcher } from ".";

const APP_ID = 123;
const FEED_COUNT = 10;
const CURRENT_STEAM_ID = "76561197960287930";
const TIMES = {
	achievement: 100,
	afterCached: 201,
	afterStatus: 151,
	historyEnd: 175,
	status: 150,
};
const COMMENT = {
	author: {
		avatarUrl: "https://example.test/avatar.png",
		nickname: "Ada",
		userId: "activity-user",
	},
	body: "Restored status",
	bodyFormat: "steam-bbcode",
	createdAt: "1970-01-01T00:02:30.000Z",
	gameId: "game",
	id: "comment",
	ownedByCurrentUser: true,
	releaseId: "release",
	releaseRevisionId: "revision",
	updatedAt: "1970-01-01T00:02:30.000Z",
};
const patchers: SteamUserNewsPatcher[] = [];
let activity: SteamAppActivity;
let statuses: UserStatusRegistry;

function createPatcher(): SteamUserNewsPatcher {
	const patcher = new SteamUserNewsPatcher(
		{
			getAchievements: mocks.getAchievements,
		} as unknown as AchievementsProvider,
		{
			registerApp: mocks.registerClan,
		} as unknown as ShortcutClanRegistry,
		{
			games: {
				getRelease: mocks.getRelease,
				isSupported: mocks.isSupported,
			} as unknown as Games,
			userStatus: {
				isInstalled: true,
				register: (status: RegisteredUserStatus) => statuses.register(status),
			} as UserStatusPatcher,
			virtualFriendPatcher: { isInstalled: true } as VirtualFriendPatcher,
		},
	);

	patchers.push(patcher);

	return patcher;
}

async function installPatcher(): Promise<SteamUserNewsPatcher> {
	const patcher = createPatcher();

	await vi.waitFor(() =>
		expect(mocks.callbacks.get("GetUserNews")).toBeTypeOf("function"),
	);

	return patcher;
}

function requestFeed(startTime = TIMES.afterCached, endTime = 0): unknown {
	const callback = mocks.callbacks.get("GetUserNews");

	if (!callback) {
		throw new Error("GetUserNews patch was not installed");
	}

	return callback([
		undefined,
		{
			Body: () => ({
				count: () => FEED_COUNT,
				endtime: () => endTime,
				filterappid: () => APP_ID,
				starttime: () => startTime,
			}),
		},
	]);
}

function newsFields(response: unknown): Array<{ eventtime: unknown }> {
	if (
		!isObjectLike(response) ||
		!("Body" in response) ||
		typeof response.Body !== "function"
	) {
		throw new TypeError("Expected a UserNews RPC response");
	}

	const body: unknown = response.Body();

	if (
		!isObjectLike(body) ||
		!("news" in body) ||
		typeof body.news !== "function"
	) {
		throw new TypeError("Expected a UserNews response body");
	}

	const events: unknown = body.news();

	if (!Array.isArray(events)) {
		throw new TypeError("Expected native news events");
	}

	return events.map((event: unknown) => {
		if (
			!isObjectLike(event) ||
			!("fields" in event) ||
			!isObjectLike(event.fields)
		) {
			throw new TypeError("Expected fixture proto fields");
		}

		if (!("eventtime" in event.fields)) {
			throw new TypeError("Expected a timestamped news event");
		}

		return event.fields;
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.cache.m_mapApps.clear();
	mocks.callbacks.clear();
	mocks.isAppShortcut.mockReturnValue(true);
	mocks.isSupported.mockReturnValue(false);
	mocks.getRelease.mockResolvedValue({
		gameId: "game",
		releaseId: "release",
		revisionId: "revision",
	});

	mocks.getActivity.mockResolvedValue({
		ok: true,
		data: { achievements: [], comments: [COMMENT] },
	});

	mocks.getFriendsGameplay.mockResolvedValue({ ok: true, data: [] });
	mocks.getAchievements.mockResolvedValue(undefined);
	const storeQueries = new Map<string, unknown>();
	const queryClient: SteamQueryClient = {
		cancelQueries: async () => undefined,
		getQueryCache: () => ({ subscribe: () => () => undefined }),
		getQueryData: (key) => storeQueries.get(JSON.stringify(key)),
		invalidateQueries: () => undefined,
		removeQueries: ({ queryKey }) => {
			storeQueries.delete(JSON.stringify(queryKey));
		},
		resetQueries: async () => undefined,
		setQueryData: (key, value) => {
			storeQueries.set(JSON.stringify(key), value);

			return value;
		},
	};

	mocks.queryClient = queryClient;
	statuses = new UserStatusRegistry();
	activity = {
		AddNewsEvents: async () => undefined,
		m_AchievementMap: new Map(),
		m_bNoMoreHistoryAvailable: true,
		m_mapActivityByDay: new Map([[0, { events: [] }]]),
		m_rtNewestActivityTime: 200,
		m_rtOldestActivityTime: 100,
		SortEvents: () => undefined,
	};

	vi.stubGlobal("window", {
		appActivityStore: {
			CMInterface: {
				steamid: { ConvertTo64BitString: () => CURRENT_STEAM_ID },
			},
			m_mapAppActivity: new Map([[APP_ID, activity]]),
		},
	});
});

afterEach(() => {
	for (const patcher of patchers.splice(0)) {
		patcher.unMount();
	}

	vi.unstubAllGlobals();
});

describe("SteamUserNewsPatcher", () => {
	it("rehydrates statuses below a restored watermark once, then preserves incremental activity", async () => {
		mocks.isSupported.mockReturnValue(true);
		await installPatcher();

		expect(newsFields(await requestFeed())).toEqual([
			{
				eventtime: 150,
				eventtype: 16,
				gameid: "123",
				steamid_actor: CURRENT_STEAM_ID,
			},
		]);

		expect(statuses.get(CURRENT_STEAM_ID, "150")?.statusText).toBe(
			"Restored status",
		);

		expect(activity.m_mapActivityByDay.size).toBe(0);
		expect(activity).toMatchObject({
			m_rtNewestActivityTime: 0,
			m_rtOldestActivityTime: 4_294_967_295,
			m_bNoMoreHistoryAvailable: false,
		});

		const mergedDay = { events: [] };

		activity.m_mapActivityByDay.set(0, mergedDay);
		activity.m_rtNewestActivityTime = 150;
		activity.m_rtOldestActivityTime = 150;
		expect(newsFields(await requestFeed(TIMES.afterStatus))).toEqual([]);
		expect(activity.m_mapActivityByDay.get(0)).toBe(mergedDay);
		expect(activity).toMatchObject({
			m_rtNewestActivityTime: 150,
			m_rtOldestActivityTime: 150,
		});
	});

	it("preserves cached activity on unavailable achievement data and retries the full rebuild", async () => {
		mocks.isSupported.mockReturnValue(true);
		mocks.getActivity.mockResolvedValue({
			ok: true,
			data: {
				comments: [COMMENT],
				achievements: [
					{
						author: COMMENT.author,
						earnedAt: "1970-01-01T00:01:40.000Z",
						id: "award",
						ownedByCurrentUser: true,
					},
				],
			},
		});

		await installPatcher();
		const cachedDay = activity.m_mapActivityByDay.get(0);

		expect(await requestFeed()).toBe("native-response");
		expect(activity.m_mapActivityByDay.get(0)).toBe(cachedDay);
		expect(activity).toMatchObject({
			m_rtNewestActivityTime: 200,
			m_rtOldestActivityTime: 100,
			m_bNoMoreHistoryAvailable: true,
		});

		expect(statuses.get(CURRENT_STEAM_ID, "150")).toBeUndefined();

		const achievement = {
			achieved: true,
			description: "Award",
			global_percent: 25,
			hidden: false,
			icon: "https://badges.test/award.png",
			id: "award",
			name: "Award",
			unlock_time: 100,
		};

		mocks.getAchievements.mockResolvedValue({
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
		});

		expect(
			newsFields(await requestFeed()).map((fields) => fields.eventtime),
		).toEqual([TIMES.status, TIMES.achievement]);

		expect(activity.m_mapActivityByDay.size).toBe(0);
		expect(statuses.get(CURRENT_STEAM_ID, "150")?.statusText).toBe(
			"Restored status",
		);
	});

	it("does not initialize or clear the feed while serving a bounded history request", async () => {
		mocks.isSupported.mockReturnValue(true);
		await installPatcher();
		const cachedDay = activity.m_mapActivityByDay.get(0);

		expect(
			newsFields(await requestFeed(0, TIMES.historyEnd)).map(
				(fields) => fields.eventtime,
			),
		).toEqual([TIMES.status]);

		expect(activity.m_mapActivityByDay.get(0)).toBe(cachedDay);
		expect(activity).toMatchObject({
			m_rtNewestActivityTime: 200,
			m_bNoMoreHistoryAvailable: true,
		});

		expect(
			newsFields(await requestFeed()).map((fields) => fields.eventtime),
		).toEqual([TIMES.status]);

		expect(activity.m_mapActivityByDay.size).toBe(0);
		expect(activity).toMatchObject({ m_bNoMoreHistoryAvailable: false });
	});

	it("passes unsupported shortcut feeds through without asking Activity", async () => {
		const patcher = createPatcher();

		await vi.waitFor(() =>
			expect(mocks.callbacks.get("GetUserNews")).toBeTypeOf("function"),
		);

		const result = mocks.callbacks.get("GetUserNews")?.([
			undefined,
			{
				Body: () => ({
					count: () => FEED_COUNT,
					endtime: () => 0,
					filterappid: () => APP_ID,
					starttime: () => 0,
				}),
			},
		]);

		expect(result).toBe(mocks.callOriginal);
		expect(mocks.getRelease).not.toHaveBeenCalled();
		patcher.unMount();
	});

	it("does not synthesize spotlight or mint a clan for an unsupported shortcut", async () => {
		const patcher = createPatcher();

		await vi.waitFor(() =>
			expect(mocks.callbacks.get("GetAppDetailsSpotlight")).toBeTypeOf(
				"function",
			),
		);

		const result = mocks.callbacks.get("GetAppDetailsSpotlight")?.([
			undefined,
			{ Body: () => ({ appid: () => APP_ID }) },
		]);

		expect(result).toBe(mocks.callOriginal);
		expect(mocks.registerClan).not.toHaveBeenCalled();
		expect(mocks.cache.m_mapApps.size).toBe(0);
		patcher.unMount();
	});

	it.each([
		{ shortcut: false, supported: true, appId: APP_ID },
		{ shortcut: true, supported: false, appId: APP_ID },
		{ shortcut: true, supported: true, appId: 0 },
		{ shortcut: true, supported: true, appId: Number.NaN },
	])(
		"leaves unrelated companion activity requests to Steam: %j",
		async ({ shortcut, supported, appId }) => {
			mocks.isAppShortcut.mockReturnValue(shortcut);
			mocks.isSupported.mockReturnValue(supported);
			const patcher = createPatcher();

			await vi.waitFor(() =>
				expect(mocks.callbacks.get("GetActivity")).toBeTypeOf("function"),
			);

			expect(
				mocks.callbacks.get("GetActivity")?.([
					undefined,
					{ Body: () => ({ appid: () => appId }) },
				]),
			).toBe(mocks.callOriginal);

			patcher.unMount();
		},
	);
});
