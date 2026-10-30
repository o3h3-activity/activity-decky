import type { DeviceAuthorizationState } from "@api/account";
import { describe, expect, it } from "vitest";
import { retroAchievementsRow } from "./activityStatus";

const signedIn = (
	retroAchievementsCredentialSync: boolean,
	retroAchievementsLinked: boolean,
): DeviceAuthorizationState => ({
	accessTokensUrl: "",
	codeExpiresAt: 0,
	message: "",
	retroAchievementsCredentialSync,
	retroAchievementsLinked,
	status: "signedIn",
	tokenExpiresAt: "",
	userCode: "",
	verificationUri: "",
	verificationUriComplete: "",
});

describe("RetroAchievements status row", () => {
	it("shows checking while the account snapshot is loading", () => {
		expect(retroAchievementsRow(undefined, undefined).value).toBe("Checking…");
	});

	it("shows unavailable after the account snapshot fails", () => {
		expect(retroAchievementsRow(undefined, "load failed").value).toBe(
			"Unavailable",
		);
	});

	it("explains automatic refresh when this Deck has credential-sync permission", () => {
		expect(
			retroAchievementsRow(signedIn(true, false), undefined).description,
		).toContain("refreshes credentials automatically");
	});

	it("distinguishes a Deck without credential-sync permission", () => {
		expect(
			retroAchievementsRow(signedIn(false, false), undefined).description,
		).toContain("not permitted");
	});
});
