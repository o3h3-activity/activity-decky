import type { DeviceAuthorizationState } from "@api/account";
import type { callOriginal, replacePatch } from "@decky/ui";
import type { AchievementsProvider } from "@steam/achievements/achievementsProvider";
import { RetroAchievements } from "@steam/achievements/retroAchievements";
import type { Games } from "@steam/games";
import { Game } from "@steam/games/game";
import type { AppStore } from "@steam/proxy/appStore";
import type {
	QueryCacheEntry,
	QueryCacheEvent,
	SteamQueryClient,
} from "@typings/queryClient";
import type logger from "@utils/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SteamYourStuffAchievementsPatcher } from "./achievements";

type PatchCallback = (this: unknown, args: unknown[]) => unknown;

type NativeSchemaResponse = {
	Body: () => { toObject: () => unknown };
	GetEResult: () => number;
	Hdr: () => { transport_error: () => number };
};
type NativeUserAchievement = {
	internal_key: () => number;
	unlock_time: () => number;
	unlocked: () => boolean;
};
type NativeUserGroup = {
	completed_achievements: () => number;
	groupid: () => number;
	is_achievable: () => boolean;
};
type NativeUserResponse = {
	Body: () => {
		achievements: () => NativeUserAchievement[];
		groups: () => NativeUserGroup[];
		schema_hash: () => number;
	};
	Hdr: () => { transport_error: () => number };
};

type DeckyUiModule = {
	callOriginal: typeof callOriginal;
	findModuleExport: (predicate: (exported: unknown) => boolean) => unknown;
	replacePatch: typeof replacePatch;
};
type AppStoreModule = { AppStore: typeof AppStore };
type LoggerModule = { default: typeof logger };

const ACTIVITY_STEAM_ID = "76561198000000000";
const UNSUPPORTED_SHORTCUT_ID = 42;
const SUPPORTED_SHORTCUT_ID = 84;
const SIGNED_OUT_STATE: DeviceAuthorizationState = {
	accessTokensUrl: "",
	codeExpiresAt: 0,
	message: "",
	retroAchievementsLinked: false,
	status: "signedOut",
	tokenExpiresAt: "",
	userCode: "",
	verificationUri: "",
	verificationUriComplete: "",
};
const MAPPED_ACHIEVEMENTS = {
	details: {
		nAchieved: 1,
		nTotal: 1,
		vecAchievedHidden: [],
		vecHighlight: [{ strID: "earned" }],
		vecUnachieved: [],
	},
	platformAchievements: [],
	platformAchievementsById: new Map(),
	rgAchievements: [{ strID: "earned" }],
};

type StoredQuery = {
	data: unknown;
	query: QueryCacheEntry;
};

function createClient(): SteamQueryClient {
	const listeners = new Set<(event: QueryCacheEvent) => void>();
	const queries = new Map<string, StoredQuery>();

	return {
		cancelQueries: async () => undefined,
		getQueryCache: () => ({
			subscribe: (listener) => {
				listeners.add(listener);

				return () => {
					listeners.delete(listener);
				};
			},
		}),
		getQueryData: (key) => queries.get(JSON.stringify(key))?.data,
		invalidateQueries: ({ predicate }) => {
			for (const { query } of queries.values()) {
				predicate(query);
			}
		},
		removeQueries: ({ queryKey }) => {
			queries.delete(JSON.stringify(queryKey));
		},
		resetQueries: async ({ predicate }) => {
			for (const entry of queries.values()) {
				if (predicate(entry.query)) {
					entry.data = undefined;
				}
			}
		},
		setQueryData: (key, data) => {
			const id = JSON.stringify(key);
			const query = queries.get(id)?.query ?? { queryKey: [...key] };

			queries.set(id, { data, query });

			for (const listener of listeners) {
				listener({
					action: { type: "success" },
					query,
					type: "updated",
				});
			}

			return data;
		},
	};
}

const mocks = vi.hoisted(() => ({
	achievementService: undefined as unknown,
	authorizationChanged: undefined as
		| ((state: DeviceAuthorizationState) => void)
		| undefined,
	providerInvalidated: undefined as (() => void) | undefined,
	invalidationVersion: 0,
	progress: vi.fn<(path: string) => Promise<unknown>>(),
	callbacks: new Map<string, PatchCallback>(),
	callOriginal: Symbol("callOriginal"),
	queryClient: undefined as SteamQueryClient | undefined,
	getAchievements: vi.fn<(appId: number) => Promise<unknown>>(),
	getAppData: vi.fn<() => unknown>(),
	getCached: vi.fn<(appId: number) => unknown>(),
	isAppShortcut: vi.fn<(appId: number) => boolean>(),
	isSupported: vi.fn<(appId: number) => boolean>(),
	shouldFetch: vi.fn<(appId: number) => boolean>(),
	unpatch: vi.fn<() => void>(),
}));

vi.mock(
	import("@api/account"),
	() =>
		({
			onDeviceAuthorizationChanged: (
				listener: (state: DeviceAuthorizationState) => void,
			) => {
				mocks.authorizationChanged = listener;

				return () => {
					mocks.authorizationChanged = undefined;
				};
			},
		}) as never,
);

vi.mock(
	import("@api/retroAchievements"),
	() => ({ getRetroAchievements: mocks.progress }) as never,
);

vi.mock(
	import("@decky/ui"),
	() =>
		({
			callOriginal: mocks.callOriginal,
			findModuleExport: vi.fn<
				(predicate: (exported: unknown) => boolean) => unknown
			>((predicate) =>
				[mocks.achievementService, mocks.queryClient].find((candidate) =>
					predicate(candidate),
				),
			),
			replacePatch: vi.fn<
				(
					target: unknown,
					method: string,
					callback: PatchCallback,
				) => {
					original: () => unknown;
					unpatch: typeof mocks.unpatch;
				}
			>((_target, method, callback) => {
				mocks.callbacks.set(method, callback);

				return { original: () => undefined, unpatch: mocks.unpatch };
			}),
		}) as unknown as DeckyUiModule,
);

vi.mock(
	import("@steam/proxy/appStore"),
	() =>
		({
			AppStore: { isAppShortcut: mocks.isAppShortcut },
		}) as unknown as AppStoreModule,
);

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: {
				debug: vi.fn<(...args: unknown[]) => void>(),
				error: vi.fn<(...args: unknown[]) => void>(),
				info: vi.fn<(...args: unknown[]) => void>(),
				once: { debug: vi.fn<(...args: unknown[]) => void>() },
			},
		}) as unknown as LoggerModule,
);

function createProvider(): AchievementsProvider {
	return {
		get invalidationVersion() {
			return mocks.invalidationVersion;
		},
		onInvalidated: (listener: () => void) => {
			mocks.providerInvalidated = listener;

			return () => {
				mocks.providerInvalidated = undefined;
			};
		},
		getAchievements: mocks.getAchievements,
		getCached: mocks.getCached,
		name: "Test provider",
		shouldFetch: mocks.shouldFetch,
	} as unknown as AchievementsProvider;
}

function invalidateProvider(): void {
	mocks.invalidationVersion += 1;
	mocks.providerInvalidated?.();
}

function createGames(): Games {
	return { isSupported: mocks.isSupported } as unknown as Games;
}

function invoke<T = unknown>(method: string, args: unknown[]): T {
	const callback = mocks.callbacks.get(method);

	if (!callback) {
		throw new Error(`Missing ${method} patch`);
	}

	const result = callback(args);

	return result as T;
}

async function installPatcher(
	provider = createProvider(),
): Promise<SteamYourStuffAchievementsPatcher> {
	const patcher = new SteamYourStuffAchievementsPatcher(
		provider,
		createGames(),
	);

	await vi.waitFor(() =>
		expect(mocks.callbacks.get("GetAchievements")).toBeTypeOf("function"),
	);

	return patcher;
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.queryClient = undefined;
	mocks.authorizationChanged = undefined;
	mocks.providerInvalidated = undefined;
	mocks.invalidationVersion = 0;
	mocks.progress.mockReset();
	mocks.callbacks.clear();
	mocks.getAppData.mockReset();
	mocks.achievementService = {
		GetGameAchievements: vi.fn<() => unknown>(),
		GetGlobalAchievementPercentages: vi.fn<() => unknown>(),
		GetUserAchievements: vi.fn<() => unknown>(),
	};

	mocks.isAppShortcut.mockReturnValue(true);
	mocks.isSupported.mockReturnValue(false);
	mocks.shouldFetch.mockReturnValue(false);
	mocks.getCached.mockReturnValue(undefined);
	mocks.getAchievements.mockResolvedValue(undefined);
	vi.stubGlobal("window", {
		App: { m_CurrentUser: { strSteamID: ACTIVITY_STEAM_ID } },
		appDetailsStore: {
			GetAchievements: vi.fn<() => unknown>(),
			GetAppData: mocks.getAppData,
		},
	});

	vi.stubGlobal("SteamClient", {
		Apps: {
			GetFriendAchievementsForApp: vi.fn<() => unknown>(),
			GetMyAchievementsForApp: vi.fn<() => unknown>(),
		},
	});
});

describe("SteamYourStuffAchievementsPatcher provider invalidation", () => {
	it("removes stored progress from the previous provider epoch", async () => {
		vi.useFakeTimers();
		const appData: { details: { achievements?: unknown; unAppID: number } } = {
			details: { unAppID: SUPPORTED_SHORTCUT_ID },
		};
		const mapped = MAPPED_ACHIEVEMENTS;

		mocks.getAppData.mockReturnValue(appData);
		mocks.isSupported.mockReturnValue(true);
		mocks.getCached.mockReturnValue(mapped);

		const patcher = await installPatcher();

		expect(invoke("GetAchievements", [SUPPORTED_SHORTCUT_ID])).toBe(
			mapped.details,
		);

		await vi.advanceTimersByTimeAsync(1);

		expect(appData.details.achievements).toBe(mapped.details);

		mocks.getCached.mockReturnValue(undefined);
		invalidateProvider();

		expect(appData.details.achievements).toBeUndefined();
		expect(invoke("GetAchievements", [SUPPORTED_SHORTCUT_ID])).toEqual({
			nAchieved: 0,
			nTotal: 0,
			vecAchievedHidden: [],
			vecHighlight: [],
			vecUnachieved: [],
		});

		patcher.unMount();
	});

	it("does not inject queued achievements after invalidation", async () => {
		vi.useFakeTimers();
		const appData: { details: { achievements?: unknown; unAppID: number } } = {
			details: { unAppID: SUPPORTED_SHORTCUT_ID },
		};
		const mapped = MAPPED_ACHIEVEMENTS;

		mocks.getAppData.mockReturnValue(appData);
		mocks.isSupported.mockReturnValue(true);
		mocks.getCached.mockReturnValue(mapped);
		const patcher = await installPatcher();

		expect(invoke("GetAchievements", [SUPPORTED_SHORTCUT_ID])).toBe(
			mapped.details,
		);

		mocks.getCached.mockReturnValue(undefined);
		invalidateProvider();
		await vi.advanceTimersByTimeAsync(1);

		expect(appData.details.achievements).toBeUndefined();
		patcher.unMount();
	});

	it("does not schedule a completed old fetch after invalidation at the await boundary", async () => {
		vi.useFakeTimers();
		const appData: { details: { achievements?: unknown; unAppID: number } } = {
			details: { unAppID: SUPPORTED_SHORTCUT_ID },
		};

		mocks.getAppData.mockReturnValue(appData);
		mocks.isSupported.mockReturnValue(true);
		mocks.getAchievements.mockResolvedValue(MAPPED_ACHIEVEMENTS);
		const patcher = await installPatcher();
		const request = invoke<Promise<unknown>>("GetMyAchievementsForApp", [
			SUPPORTED_SHORTCUT_ID,
		]);

		invalidateProvider();
		await request;
		await vi.advanceTimersByTimeAsync(1);

		expect(appData.details.achievements).toBeUndefined();
		patcher.unMount();
	});

	it("rejects an old provider epoch's schema request", async () => {
		const pending = Promise.withResolvers<unknown>();

		mocks.isSupported.mockReturnValue(true);
		mocks.getAchievements.mockReturnValue(pending.promise);
		const patcher = await installPatcher();
		const request = invoke<Promise<NativeSchemaResponse>>(
			"GetGameAchievements",
			[undefined, { appid: SUPPORTED_SHORTCUT_ID }],
		);

		invalidateProvider();
		pending.resolve(MAPPED_ACHIEVEMENTS);
		await expect(request).rejects.toMatchObject({ name: "AbortError" });
		patcher.unMount();
	});
});

const RETRO_ACHIEVEMENTS_RESPONSE = {
	Achievements: {
		123: {
			BadgeName: "123",
			DateEarned: "2024-01-01 00:00:00",
			Description: "First trophy",
			DisplayOrder: 1,
			ID: 123,
			NumAwarded: 1,
			Title: "Old account",
		},
	},
	NumDistinctPlayers: 2,
	Title: "A game",
};

async function createAccountChangeFixture(): Promise<{
	appData: { details: { achievements?: unknown; unAppID: number } };
	client: SteamQueryClient;
	key: (number | string)[];
	patcher: SteamYourStuffAchievementsPatcher;
	pending: PromiseWithResolvers<unknown>;
	pendingAppId: number;
	provider: RetroAchievements;
	response: typeof RETRO_ACHIEVEMENTS_RESPONSE;
}> {
	vi.useFakeTimers();
	const pendingAppId = SUPPORTED_SHORTCUT_ID + 1;
	const pending = Promise.withResolvers<unknown>();
	const appData: { details: { achievements?: unknown; unAppID: number } } = {
		details: { unAppID: SUPPORTED_SHORTCUT_ID },
	};
	const client = createClient();
	const key = ["achievements", SUPPORTED_SHORTCUT_ID, "schema"];

	client.setQueryData(key, { achievements: ["old account"] });
	mocks.queryClient = client;
	mocks.getAppData.mockReturnValue(appData);
	mocks.isSupported.mockReturnValue(true);
	mocks.progress
		.mockResolvedValueOnce(RETRO_ACHIEVEMENTS_RESPONSE)
		.mockReturnValueOnce(pending.promise);

	const provider = new RetroAchievements({
		get: async (appId) => Game.launching(appId, `/roms/${appId}.iso`),
	});
	const patcher = await installPatcher(provider);

	return {
		appData,
		client,
		key,
		patcher,
		pending,
		pendingAppId,
		provider,
		response: RETRO_ACHIEVEMENTS_RESPONSE,
	};
}

describe("RetroAchievements account invalidation through Steam", () => {
	it.each(["signedIn", "signedOut"] as const)(
		"%s clears provider and Steam data and aborts the previous account's request",
		async (status) => {
			const {
				appData,
				client,
				key,
				patcher,
				pending,
				pendingAppId,
				provider,
				response,
			} = await createAccountChangeFixture();
			const mapped = await provider.getAchievements(SUPPORTED_SHORTCUT_ID);

			invoke("GetAchievements", [SUPPORTED_SHORTCUT_ID]);
			await vi.advanceTimersByTimeAsync(1);
			expect(appData.details.achievements).toBe(mapped?.details);
			const request = invoke<Promise<NativeSchemaResponse>>(
				"GetGameAchievements",
				[undefined, { appid: pendingAppId }],
			);

			await Promise.resolve();
			expect(mocks.progress).toHaveBeenCalledWith(`/roms/${pendingAppId}.iso`);
			mocks.authorizationChanged?.({ ...SIGNED_OUT_STATE, status });

			expect(provider.getCached(SUPPORTED_SHORTCUT_ID)).toBeUndefined();
			expect(appData.details.achievements).toBeUndefined();
			expect(client.getQueryData(key)).toBeUndefined();

			const newResponse = {
				...response,
				Achievements: {
					123: {
						...response.Achievements[123],
						DateEarned: undefined,
						Title: "New account",
					},
				},
			};

			mocks.progress.mockResolvedValue(newResponse);
			const current = await provider.getAchievements(pendingAppId);

			pending.resolve(response);
			await expect(request).rejects.toMatchObject({ name: "AbortError" });
			expect(provider.getCached(pendingAppId)).toBe(current);
			expect(current?.platformAchievements[0]).toMatchObject({
				achieved: false,
				name: "New account",
			});

			await vi.advanceTimersByTimeAsync(1);
			expect(appData.details.achievements).toBeUndefined();
			patcher.unMount();
			provider.unMount();
		},
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("SteamYourStuffAchievementsPatcher eligibility", () => {
	it("passes an unsupported shortcut through every achievement entrypoint", async () => {
		await installPatcher();

		expect(invoke("GetAchievements", [UNSUPPORTED_SHORTCUT_ID])).toBe(
			mocks.callOriginal,
		);

		expect(invoke("GetMyAchievementsForApp", [UNSUPPORTED_SHORTCUT_ID])).toBe(
			mocks.callOriginal,
		);

		expect(
			invoke("GetFriendAchievementsForApp", [UNSUPPORTED_SHORTCUT_ID]),
		).toBe(mocks.callOriginal);

		expect(
			invoke("GetGameAchievements", [
				undefined,
				{ appid: UNSUPPORTED_SHORTCUT_ID, language: "english" },
			]),
		).toBe(mocks.callOriginal);

		expect(
			invoke("GetGlobalAchievementPercentages", [
				undefined,
				{ appid: UNSUPPORTED_SHORTCUT_ID },
			]),
		).toBe(mocks.callOriginal);

		expect(
			invoke("GetUserAchievements", [
				undefined,
				{ appid: UNSUPPORTED_SHORTCUT_ID, steamid: ACTIVITY_STEAM_ID },
			]),
		).toBe(mocks.callOriginal);
	});

	it("passes a supported non-shortcut through", async () => {
		mocks.isAppShortcut.mockReturnValue(false);
		mocks.isSupported.mockReturnValue(true);
		await installPatcher();

		expect(invoke("GetAchievements", [SUPPORTED_SHORTCUT_ID])).toBe(
			mocks.callOriginal,
		);
	});

	it("serves supported shortcuts", async () => {
		const mapped = {
			details: {
				nAchieved: 1,
				nTotal: 1,
				vecAchievedHidden: [],
				vecHighlight: [],
				vecUnachieved: [],
			},
			platformAchievements: [],
			platformAchievementsById: new Map(),
			rgAchievements: [{ strID: "earned" }],
		};

		mocks.isSupported.mockReturnValue(true);
		mocks.getCached.mockReturnValue(mapped);
		mocks.getAchievements.mockResolvedValue(mapped);
		const patcher = await installPatcher();

		expect(invoke("GetAchievements", [SUPPORTED_SHORTCUT_ID])).toBe(
			mapped.details,
		);

		await expect(
			invoke("GetMyAchievementsForApp", [SUPPORTED_SHORTCUT_ID]),
		).resolves.toEqual({
			data: { rgAchievements: mapped.rgAchievements },
			result: 1,
		});

		await expect(
			invoke("GetFriendAchievementsForApp", [SUPPORTED_SHORTCUT_ID]),
		).resolves.toEqual({
			data: { rgAchievements: [] },
			result: 1,
		});

		patcher.unMount();
	});
});

describe("SteamYourStuffAchievementsPatcher native Your Stuff queries", () => {
	it("rejects unavailable metadata and returns an empty native schema after recovery", async () => {
		mocks.isSupported.mockReturnValue(true);
		const patcher = await installPatcher();

		await expect(
			invoke<Promise<NativeSchemaResponse>>("GetGameAchievements", [
				undefined,
				{ appid: SUPPORTED_SHORTCUT_ID },
			]),
		).rejects.toBeInstanceOf(Error);

		mocks.getAchievements.mockResolvedValue(MAPPED_ACHIEVEMENTS);
		const response = await invoke<Promise<NativeSchemaResponse>>(
			"GetGameAchievements",
			[undefined, { appid: SUPPORTED_SHORTCUT_ID }],
		);

		expect(response.Body().toObject()).toEqual({ achievements: [] });
		patcher.unMount();
	});

	it("resets managed query data on account change without clearing unrelated query data", async () => {
		const client = createClient();
		const managedKey = [
			"achievements",
			SUPPORTED_SHORTCUT_ID,
			"user_achievements",
			ACTIVITY_STEAM_ID,
		];
		const unrelatedAppKey = ["achievements", UNSUPPORTED_SHORTCUT_ID, "schema"];
		const unrelatedAreaKey = ["friends", SUPPORTED_SHORTCUT_ID];

		client.setQueryData(managedKey, { achievements: ["old account"] });
		client.setQueryData(unrelatedAppKey, { achievements: ["other app"] });
		client.setQueryData(unrelatedAreaKey, { friends: ["unrelated area"] });
		mocks.queryClient = client;
		mocks.isSupported.mockImplementation(
			(appId) => appId === SUPPORTED_SHORTCUT_ID,
		);

		mocks.getAchievements.mockResolvedValue(MAPPED_ACHIEVEMENTS);
		const patcher = await installPatcher();

		await invoke<Promise<NativeUserResponse>>("GetUserAchievements", [
			undefined,
			{ appid: SUPPORTED_SHORTCUT_ID, steamid: ACTIVITY_STEAM_ID },
		]);

		invalidateProvider();

		expect(client.getQueryData(managedKey)).toBeUndefined();
		expect(client.getQueryData(unrelatedAppKey)).toEqual({
			achievements: ["other app"],
		});

		expect(client.getQueryData(unrelatedAreaKey)).toEqual({
			friends: ["unrelated area"],
		});

		patcher.unMount();
	});

	it("repairs badge URLs without replacing native schema metadata", async () => {
		const client = createClient();
		const key = ["achievements", SUPPORTED_SHORTCUT_ID, "schema"];
		const nativeSchema = {
			language: "french",
			schema_hash: 17,
			groups: [
				{
					id: 0,
					name: "Jeu de base",
					achievements: [
						{
							api_name: "earned",
							icon_achieved:
								"https://steam.test/https://badges.test/earned.png",
							icon_unachieved:
								"https://steam.test/https://badges.test/locked.png",
							min_progress: 1,
							max_progress: 10,
						},
					],
				},
			],
		};
		const achievement = {
			achieved: true,
			description: "Earned description",
			global_percent: 50,
			hidden: false,
			icon: "https://badges.test/locked.png",
			id: "earned",
			name: "Earned",
			unlock_time: 1_700_000_000,
			unlocked_icon: "https://badges.test/earned.png",
		};
		const mapped = {
			...MAPPED_ACHIEVEMENTS,
			platformAchievements: [achievement],
			platformAchievementsById: new Map([[achievement.id, achievement]]),
		};

		mocks.queryClient = client;
		mocks.isSupported.mockReturnValue(true);
		mocks.getCached.mockReturnValue(mapped);
		mocks.getAchievements.mockResolvedValue(mapped);
		const patcher = await installPatcher();

		await invoke<Promise<NativeSchemaResponse>>("GetGameAchievements", [
			undefined,
			{ appid: SUPPORTED_SHORTCUT_ID },
		]);

		client.setQueryData(key, nativeSchema);

		expect(client.getQueryData(key)).toEqual({
			language: "french",
			schema_hash: 17,
			groups: [
				{
					id: 0,
					name: "Jeu de base",
					achievements: [
						{
							api_name: "earned",
							icon_achieved: "https://badges.test/earned.png",
							icon_unachieved: "https://badges.test/locked.png",
							min_progress: 1,
							max_progress: 10,
						},
					],
				},
			],
		});

		patcher.unMount();
	});

	it("clears invalidated native query data on unload after support changes", async () => {
		const client = createClient();
		const key = ["achievements", SUPPORTED_SHORTCUT_ID, "schema"];

		client.setQueryData(key, { achievements: ["old account"] });
		mocks.queryClient = client;
		mocks.isSupported.mockReturnValue(true);
		const patcher = await installPatcher();

		mocks.isSupported.mockReturnValue(false);
		patcher.unMount();

		expect(client.getQueryData(key)).toBeUndefined();
	});

	it("serves unlocked and locked RetroAchievements to the linked Steam account", async () => {
		const platformAchievements = [
			{
				achieved: true,
				description: "Earned description",
				global_percent: 50,
				hidden: false,
				icon: "https://example.test/earned-locked.png",
				id: "earned",
				name: "Earned",
				unlock_time: 1_700_000_000,
				unlocked_icon: "https://example.test/earned.png",
			},
			{
				achieved: false,
				description: "Locked description",
				global_percent: 25,
				hidden: false,
				icon: "https://example.test/locked.png",
				id: "locked",
				name: "Locked",
				unlock_time: 0,
			},
		];
		const mapped = {
			details: {
				nAchieved: 1,
				nTotal: 2,
				vecAchievedHidden: [],
				vecHighlight: [],
				vecUnachieved: [],
			},
			platformAchievements,
			platformAchievementsById: new Map(
				platformAchievements.map((achievement) => [
					achievement.id,
					achievement,
				]),
			),
			rgAchievements: [],
		};

		mocks.isSupported.mockReturnValue(true);
		mocks.getAchievements.mockResolvedValue(mapped);
		const patcher = await installPatcher();

		const schema = await invoke<Promise<NativeSchemaResponse>>(
			"GetGameAchievements",
			[undefined, { appid: SUPPORTED_SHORTCUT_ID, language: "english" }],
		);
		const user = await invoke<Promise<NativeUserResponse>>(
			"GetUserAchievements",
			[undefined, { appid: SUPPORTED_SHORTCUT_ID, steamid: ACTIVITY_STEAM_ID }],
		);

		expect(schema.GetEResult()).toBe(1);
		expect(schema.Hdr().transport_error()).toBe(0);
		expect(schema.Body().toObject()).toEqual({
			achievements: [
				{
					archived: false,
					groupid: 0,
					hidden: false,
					icon: "https://example.test/earned.png",
					icon_gray: "https://example.test/earned-locked.png",
					internal_key: 1,
					internal_name: "earned",
					localized_desc: "Earned description",
					localized_name: "Earned",
				},
				{
					archived: false,
					groupid: 0,
					hidden: false,
					icon: "https://example.test/locked.png",
					icon_gray: "https://example.test/locked.png",
					internal_key: 2,
					internal_name: "locked",
					localized_desc: "Locked description",
					localized_name: "Locked",
				},
			],
		});

		expect(
			user
				.Body()
				.achievements()
				.map((achievement) => ({
					internal_key: achievement.internal_key(),
					unlock_time: achievement.unlock_time(),
					unlocked: achievement.unlocked(),
				})),
		).toEqual([
			{ internal_key: 1, unlock_time: 1_700_000_000, unlocked: true },
			{ internal_key: 2, unlock_time: 0, unlocked: false },
		]);

		expect(
			user
				.Body()
				.groups()
				.map((group) => ({
					completed_achievements: group.completed_achievements(),
					groupid: group.groupid(),
					is_achievable: group.is_achievable(),
				})),
		).toEqual([{ completed_achievements: 1, groupid: 0, is_achievable: true }]);

		expect(user.Hdr().transport_error()).toBe(0);
		expect(
			invoke("GetUserAchievements", [
				undefined,
				{ appid: SUPPORTED_SHORTCUT_ID, steamid: "76561198000000001" },
			]),
		).toBe(mocks.callOriginal);

		patcher.unMount();
	});
});
