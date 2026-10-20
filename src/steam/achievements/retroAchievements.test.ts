import type { DeviceAuthorizationState } from "@api/account";
import { Game } from "@steam/games/game";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	authorizationChanged: undefined as
		| ((state: DeviceAuthorizationState) => void)
		| undefined,
	progress: vi.fn<(path: string) => Promise<unknown>>(),
	logger: {
		debug: vi.fn<() => void>(),
		error: vi.fn<() => void>(),
		info: vi.fn<() => void>(),
		once: { debug: vi.fn<() => void>() },
	},
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

vi.mock(import("@utils/logger"), () => ({ default: mocks.logger }) as never);

import { RetroAchievements } from "./retroAchievements";

const SHORTCUT_WITH_PATH = 10;
const SHORTCUT_WITHOUT_PATH = 20;
const SIGNED_IN: DeviceAuthorizationState = {
	accessTokensUrl: "",
	codeExpiresAt: 0,
	message: "",
	retroAchievementsLinked: true,
	status: "signedIn",
	tokenExpiresAt: "2999-01-01T00:00:00Z",
	userCode: "",
	verificationUri: "",
	verificationUriComplete: "",
};

const response = {
	Title: "A game",
	NumDistinctPlayers: 2,
	Achievements: {
		123: {
			BadgeName: "123",
			DateEarned: "2024-01-01 00:00:00",
			Description: "First trophy",
			DisplayOrder: 1,
			ID: 123,
			NumAwarded: 1,
			Title: "Explorer",
		},
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.authorizationChanged = undefined;
	mocks.progress.mockReset();
	mocks.progress.mockResolvedValue(response);
});

describe("RetroAchievements game discovery", () => {
	it("maps achievements for the ROM the shortcut launches", async () => {
		const provider = new RetroAchievements({
			get: async (appId) => Game.launching(appId, "/roms/current.iso"),
		});

		const achievements = await provider.getAchievements(SHORTCUT_WITH_PATH);

		expect(achievements?.details.nTotal).toBe(1);
		expect(achievements?.platformAchievements[0].name).toBe("Explorer");
		expect(mocks.progress).toHaveBeenCalledWith("/roms/current.iso");
		provider.unMount();
	});

	it("does not request achievements when the shortcut launches no ROM", async () => {
		const provider = new RetroAchievements({ get: async () => undefined });

		const achievements = await provider.getAchievements(SHORTCUT_WITHOUT_PATH);

		expect(achievements).toBeUndefined();
		expect(mocks.progress).not.toHaveBeenCalled();
		provider.unMount();
	});

	it("loads metadata immediately after sign-in instead of retaining the missing-credential backoff", async () => {
		// oxlint-disable-next-line unicorn/no-null -- The backend returns null without session-issued RA credentials.
		mocks.progress.mockResolvedValueOnce(null);
		const provider = new RetroAchievements({
			get: async (appId) => Game.launching(appId, "/roms/current.iso"),
		});

		expect(await provider.getAchievements(SHORTCUT_WITH_PATH)).toBeUndefined();
		mocks.authorizationChanged?.(SIGNED_IN);
		const achievements = await provider.getAchievements(SHORTCUT_WITH_PATH);

		expect(achievements?.platformAchievements[0].name).toBe("Explorer");
		provider.unMount();
	});

	it("does not serve the previous account's cached progress after sign-out", async () => {
		const provider = new RetroAchievements({
			get: async (appId) => Game.launching(appId, "/roms/current.iso"),
		});

		const beforeSignOut = await provider.getAchievements(SHORTCUT_WITH_PATH);

		expect(beforeSignOut?.platformAchievements[0]).toMatchObject({
			achieved: true,
			name: "Explorer",
		});

		// oxlint-disable-next-line unicorn/no-null -- Signed-out sessions return no RA progress.
		mocks.progress.mockResolvedValue(null);
		mocks.authorizationChanged?.({ ...SIGNED_IN, status: "signedOut" });

		expect(await provider.getAchievements(SHORTCUT_WITH_PATH)).toBeUndefined();
		provider.unMount();
	});

	it("does not let an old account's in-flight progress replace the newly signed-in account's cache", async () => {
		const oldResponse = Promise.withResolvers<unknown>();
		const newResponse = {
			...response,
			Achievements: {
				123: {
					...response.Achievements[123],
					DateEarned: undefined,
					Title: "New account's trophy",
				},
			},
		};

		mocks.progress
			.mockReturnValueOnce(oldResponse.promise)
			.mockResolvedValueOnce(newResponse);

		const provider = new RetroAchievements({
			get: async (appId) => Game.launching(appId, "/roms/current.iso"),
		});
		const oldRequest = provider.getAchievements(SHORTCUT_WITH_PATH);

		await Promise.resolve();
		mocks.authorizationChanged?.(SIGNED_IN);
		const newRequest = provider.getAchievements(SHORTCUT_WITH_PATH);

		oldResponse.resolve(response);
		expect(await oldRequest).toBeUndefined();
		const achievements = await newRequest;

		expect(achievements?.platformAchievements[0]).toMatchObject({
			achieved: false,
			name: "New account's trophy",
			unlock_time: 0,
		});

		const cached = await provider.getAchievements(SHORTCUT_WITH_PATH);

		expect(cached?.platformAchievements[0].name).toBe("New account's trophy");

		provider.unMount();
	});
});
