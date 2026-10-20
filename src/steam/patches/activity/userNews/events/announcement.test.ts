import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import type { SteamAppActivity } from "@typings/appActivityStore";
import type {
	SteamUserNewsProtoEvent,
	SteamUserNewsProtoEventConstructor,
} from "@typings/userNewsService";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserNewsEventContext } from "./types";

const mocks = vi.hoisted(() => ({
	announcements: vi.fn<(...args: unknown[]) => Promise<undefined>>(),
}));
const APP_ID = 42;

vi.mock(
	import("@steam/patches/eventsAndAnnouncements/announcementSource"),
	() => ({ getAnnouncements: mocks.announcements }),
);

import { AnnouncementUserNewsEventHandler } from "./announcement";

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

function createRegistry(): {
	clans: ShortcutClanRegistry;
	registerApp: (appId: number) => void;
} {
	const registerApp = vi.fn<(appId: number) => void>();

	return {
		clans: {
			has: vi.fn<(clanAccountId: number) => boolean>(() => false),
			registerApp,
		} as unknown as ShortcutClanRegistry,
		registerApp,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.announcements.mockResolvedValue(undefined);
});

describe("announcement user news events", () => {
	it("returns no events while the announcement source is unavailable", async () => {
		const { clans, registerApp } = createRegistry();
		const result = await new AnnouncementUserNewsEventHandler(clans).create(
			{ appId: APP_ID, count: 10, startTime: 100, endTime: 200 },
			createContext(),
		);

		expect(result).toEqual([]);
		expect(registerApp).toHaveBeenCalledWith(APP_ID);
		expect(mocks.announcements).toHaveBeenCalledWith({
			appId: APP_ID,
			count: 10,
			endTime: 200,
			startTime: 100,
		});
	});
});
