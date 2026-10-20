import { expect, it } from "vitest";
import { SteamUserNewsEventType } from "./steamUserNewsEventType";

const EXPECTED_EVENT_TYPES = {
	AchievementUnlocked: 2,
	Announcement: 1002,
	PlayedFirstTime: 30,
	ReceivedNewGame: 3,
	UserStatus: 16,
};

it("names the Steam user-news protobuf event type IDs", () => {
	expect(SteamUserNewsEventType).toMatchObject(EXPECTED_EVENT_TYPES);
});
