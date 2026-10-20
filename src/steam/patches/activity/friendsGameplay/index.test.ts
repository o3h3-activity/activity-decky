import type { getFriendsGameplay } from "@api/activity";
import type { ApiResult } from "@api/rpc/result";
import type { callOriginal, replacePatch, sleep } from "@decky/ui";
import type { EResult } from "@decky/ui/dist/globals/steam-client/shared";
import type { Games } from "@steam/games";
import type { AppStore } from "@steam/proxy/appStore";
import type { PlayerService } from "@steam/proxy/playerService";
import type { QueryClient } from "@steam/proxy/queryClient";
import type logger from "@utils/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VirtualFriendPatcher } from "../virtualFriends";

type ActivityApiModule = {
	getFriendsGameplay: typeof getFriendsGameplay;
};
type DeckyUiModule = {
	callOriginal: typeof callOriginal;
	replacePatch: typeof replacePatch;
	sleep: typeof sleep;
};
type SharedModule = {
	EResult: typeof EResult;
};
type AppStoreModule = {
	AppStore: typeof AppStore;
};
type PlayerServiceModule = {
	PlayerService: typeof PlayerService;
};
type QueryClientModule = {
	QueryClient: typeof QueryClient;
};
type LoggerModule = {
	default: typeof logger;
};
type PatchCallback = (args: unknown[]) => unknown;
type GameplayResponse = {
	Body: () => { toObject: () => Record<string, unknown> };
	BSuccess: () => boolean;
	GetEResult: () => number;
};

const mocks = vi.hoisted(() => {
	const service = {
		GetFriendsGameplayInfo: vi.fn<(...args: unknown[]) => unknown>(),
	};

	return {
		callback: undefined as PatchCallback | undefined,
		callOriginal: Symbol("callOriginal"),
		getFriendsGameplay:
			vi.fn<
				(
					gameId: string,
					releaseId: string,
					releaseRevisionId: string,
				) => Promise<ApiResult>
			>(),
		getRelease: vi.fn<(appId: number) => Promise<unknown>>(),
		getPlayerService: vi.fn<() => unknown>(() => service),
		isSupported: vi.fn<(appId: number) => boolean>(() => true),
		original: vi.fn<(...args: unknown[]) => string>(() => "native-response"),
		register: vi.fn<(friend: unknown) => boolean>(() => true),
		service,
		sleep: vi.fn<() => Promise<void>>(() => Promise.resolve()),
		unpatch: vi.fn<() => void>(),
	};
});

vi.mock(
	import("@api/activity"),
	() =>
		({
			getFriendsGameplay: mocks.getFriendsGameplay,
		}) as unknown as ActivityApiModule,
);

vi.mock(
	import("@decky/ui"),
	() =>
		({
			callOriginal: mocks.callOriginal,
			replacePatch: vi.fn<
				(
					target: unknown,
					method: string,
					callback: PatchCallback,
				) => { original: typeof mocks.original; unpatch: typeof mocks.unpatch }
			>((_target: unknown, _method: string, callback: PatchCallback) => {
				mocks.callback = callback;

				return { original: mocks.original, unpatch: mocks.unpatch };
			}),
			sleep: mocks.sleep,
		}) as unknown as DeckyUiModule,
);

vi.mock(
	import("@decky/ui/dist/globals/steam-client/shared"),
	() => ({ EResult: { OK: 1 } }) as unknown as SharedModule,
);

vi.mock(
	import("@steam/proxy/appStore"),
	() =>
		({
			AppStore: {
				isAppShortcut: vi.fn<(appId: number) => boolean>(() => true),
			},
		}) as unknown as AppStoreModule,
);

vi.mock(
	import("@steam/proxy/playerService"),
	() =>
		({
			PlayerService: {
				getPlayerService: mocks.getPlayerService,
			},
		}) as unknown as PlayerServiceModule,
);

vi.mock(
	import("@steam/proxy/queryClient"),
	() =>
		({
			QueryClient: {
				getQueryClient: vi.fn<() => undefined>(() => undefined),
			},
		}) as unknown as QueryClientModule,
);

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: { error: vi.fn<(...args: unknown[]) => void>() },
		}) as unknown as LoggerModule,
);

import { SteamFriendsGameplayPatcher } from ".";

const APP_ID = 123;
const GAME_ID = "01234567-89ab-4cde-8f01-23456789abcd";
const RELEASE_ID = "a0b1c2d3-1234-4abc-8def-0123456789ab";
const REVISION_ID = "b1c2d3e4-2345-4bcd-9ef0-123456789abc";
// oxlint-disable-next-line unicorn/no-null -- UserProfileResponse permits a null avatar URL.
const NULL_AVATAR = null;

const EMPTY_INFO = {
	in_game: [],
	in_wishlist: [],
	owns: [],
	played_ever: [],
	played_recently: [],
};

function gameplayUser(
	steamId: string,
	nickname: string,
): Record<string, unknown> {
	return {
		avatarUrl: NULL_AVATAR,
		nickname,
		steamId,
		userId: `user-${nickname}`,
	};
}

async function requestGameplay(): Promise<GameplayResponse> {
	await vi.waitFor(() => expect(mocks.callback).toBeTypeOf("function"));

	return (await mocks.callback?.([
		undefined,
		{ Body: () => ({ appid: () => APP_ID }) },
	])) as GameplayResponse;
}

function createPatcher(): SteamFriendsGameplayPatcher {
	return new SteamFriendsGameplayPatcher({
		games: {
			getRelease: mocks.getRelease,
			isSupported: mocks.isSupported,
		} as unknown as Games,
		virtualFriendPatcher: {
			register: mocks.register,
		} as unknown as VirtualFriendPatcher,
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.callback = undefined;
	mocks.getRelease.mockResolvedValue({
		gameId: GAME_ID,
		releaseId: RELEASE_ID,
		revisionId: REVISION_ID,
	});

	mocks.isSupported.mockReturnValue(true);
});

describe("SteamFriendsGameplayPatcher", () => {
	it("serves complete recognised shortcut gameplay from Activity and registers displayed friends", async () => {
		mocks.getFriendsGameplay.mockResolvedValue({
			data: [
				{
					hasPlayed: true,
					minutesPlayedLastTwoWeeks: 30,
					minutesPlayedTotal: 300,
					user: gameplayUser("76561197960265729", "Recent"),
				},
				{
					hasPlayed: true,
					minutesPlayedLastTwoWeeks: 0,
					minutesPlayedTotal: 300,
					user: gameplayUser("76561197960265730", "Previous"),
				},
				{
					hasPlayed: true,
					minutesPlayedLastTwoWeeks: 0,
					minutesPlayedTotal: 0,
					user: gameplayUser("76561197960265731", "Sub-minute"),
				},
				{
					hasPlayed: false,
					minutesPlayedLastTwoWeeks: 0,
					minutesPlayedTotal: 0,
					user: gameplayUser("76561197960265732", "Never"),
				},
				{
					hasPlayed: true,
					// oxlint-disable-next-line unicorn/no-null -- Legacy null durations are invalid in the new API.
					minutesPlayedLastTwoWeeks: null,
					minutesPlayedTotal: 1,
					user: gameplayUser("76561197960265733", "Invalid duration"),
				},
				{
					hasPlayed: "true",
					minutesPlayedLastTwoWeeks: 1,
					minutesPlayedTotal: 1,
					user: gameplayUser("76561197960265734", "Invalid flag"),
				},
				{
					hasPlayed: true,
					minutesPlayedLastTwoWeeks: 1.5,
					minutesPlayedTotal: 1,
					user: gameplayUser("76561197960265735", "Fractional duration"),
				},
				{
					hasPlayed: true,
					minutesPlayedLastTwoWeeks: 1,
					minutesPlayedTotal: 1,
					user: {},
				},
			],
			ok: true,
		});

		const patcher = createPatcher();
		const response = await requestGameplay();

		// oxlint-disable-next-line vitest/prefer-strict-boolean-matchers
		expect(response.BSuccess()).toBeTruthy();
		expect(response.GetEResult()).toBe(1);
		expect(response.Body().toObject()).toEqual({
			...EMPTY_INFO,
			played_ever: [
				{
					minutes_played: 0,
					minutes_played_forever: 300,
					steamid: "76561197960265730",
				},
				{
					minutes_played: 0,
					minutes_played_forever: 0,
					steamid: "76561197960265731",
				},
			],
			played_recently: [
				{
					minutes_played: 30,
					minutes_played_forever: 300,
					steamid: "76561197960265729",
				},
			],
		});

		expect(mocks.getFriendsGameplay).toHaveBeenCalledWith(
			GAME_ID,
			RELEASE_ID,
			REVISION_ID,
		);

		expect(mocks.register.mock.calls).toEqual([
			[{ nickname: "Recent", steamId: "76561197960265729" }],
			[{ nickname: "Previous", steamId: "76561197960265730" }],
			[{ nickname: "Sub-minute", steamId: "76561197960265731" }],
		]);

		expect(mocks.original).not.toHaveBeenCalled();
		patcher.unMount();
	});

	it.each([
		{
			name: "game ID",
			release: { releaseId: RELEASE_ID, revisionId: REVISION_ID },
		},
		{
			name: "release ID",
			release: { gameId: GAME_ID, revisionId: REVISION_ID },
		},
	])(
		"answers a recognised catalog identity missing its $name with empty gameplay",
		async ({ release }) => {
			mocks.getRelease.mockResolvedValue(release);
			const patcher = createPatcher();
			const response = await requestGameplay();

			expect(response.GetEResult()).toBe(1);
			expect(response.Body().toObject()).toEqual(EMPTY_INFO);
			expect(mocks.getFriendsGameplay).not.toHaveBeenCalled();
			expect(mocks.register).not.toHaveBeenCalled();
			patcher.unMount();
		},
	);

	it("passes unsupported shortcuts through to Steam without asking Activity", async () => {
		mocks.isSupported.mockReturnValue(false);
		const patcher = createPatcher();

		await expect(requestGameplay()).resolves.toBe(mocks.callOriginal);
		expect(mocks.getFriendsGameplay).not.toHaveBeenCalled();
		expect(mocks.getRelease).not.toHaveBeenCalled();
		patcher.unMount();
	});

	it.each([
		{
			name: "a failed request",
			result: { error: "unreachable", ok: false, status: 0 } as const,
		},
		{ name: "a malformed body", result: { data: {}, ok: true } as const },
	])("answers $name with empty gameplay", async ({ result }) => {
		mocks.getFriendsGameplay.mockResolvedValue(result);
		const patcher = createPatcher();
		const response = await requestGameplay();

		expect(response.GetEResult()).toBe(1);
		expect(response.Body().toObject()).toEqual(EMPTY_INFO);
		expect(mocks.register).not.toHaveBeenCalled();
		patcher.unMount();
	});
});
