import { describe, expect, it } from "vitest";
import { retroAchievementsRow } from "./activityStatus";

describe("RetroAchievements status row", () => {
	it("shows checking while the account snapshot is loading", () => {
		expect(retroAchievementsRow(undefined, undefined).value).toBe("Checking…");
	});

	it("shows unavailable after the account snapshot fails", () => {
		expect(retroAchievementsRow(undefined, "load failed").value).toBe(
			"Unavailable",
		);
	});
});
