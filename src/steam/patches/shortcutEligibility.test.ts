/* oxlint-disable vitest/prefer-strict-boolean-matchers -- Conflicts with the required prefer-to-be-truthy/falsy rules. */
import { EAppType } from "@decky/ui/dist/globals/steam-client/App";
import { Games } from "@steam/games";
import { DiscIdentity, type Game } from "@steam/games/game";
import type { Identity } from "@steam/games/identity";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isSupportedShortcut } from "./shortcutEligibility";

vi.mock(import("@api/catalog"), () => ({}) as never);
vi.mock(import("@api/discIdentity"), () => ({}) as never);

const APP_ID = 10;
const ROM_PATH = "/roms/Ico.iso";
const DISC = DiscIdentity.fromResult({
	appId: APP_ID,
	game_identity_md5: "0123456789abcdef0123456789abcdef",
	platform: "ps2",
	rcheevos_id: 21,
	serial: "SCUS-97113",
});

function createIdentity(): Identity {
	return {
		shortcutAppIds: () => [],
		locate: async () => ROM_PATH,
		identify: async (games: readonly Game[]) =>
			games.map((game) => game.identifiedAs(DISC)),
	};
}

function setOverview(appType?: EAppType): void {
	vi.stubGlobal("window", {
		appStore: {
			GetAppOverviewByAppID: () =>
				appType === undefined
					? undefined
					: { app_type: appType, third_party_mod: false },
		},
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("isSupportedShortcut", () => {
	it.each([EAppType.Game, undefined])(
		"does not inspect game support when the overview type is %s",
		async (appType) => {
			setOverview(appType);
			const games = new Games(createIdentity());

			await games.get(APP_ID);
			const support = vi.spyOn(games, "isSupported");

			expect(isSupportedShortcut(games, APP_ID)).toBeFalsy();
			expect(support).not.toHaveBeenCalled();
			games.unMount();
		},
	);

	it("leaves an unknown shortcut untouched while starting background identification", async () => {
		setOverview(EAppType.Shortcut);
		const identity = createIdentity();
		const { promise, resolve } = Promise.withResolvers<string | undefined>();
		const locate = vi.spyOn(identity, "locate").mockReturnValueOnce(promise);
		const games = new Games(identity);

		expect(isSupportedShortcut(games, APP_ID)).toBeFalsy();
		resolve(ROM_PATH);
		await games.get(APP_ID);

		expect(isSupportedShortcut(games, APP_ID)).toBeTruthy();
		expect(locate).toHaveBeenCalledOnce();
		games.unMount();
	});

	it("keeps an unidentified shortcut ineligible after loading", async () => {
		setOverview(EAppType.Shortcut);
		const identity = createIdentity();

		identity.identify = async (games) => [...games];
		const games = new Games(identity);

		await games.get(APP_ID);

		expect(isSupportedShortcut(games, APP_ID)).toBeFalsy();
		games.unMount();
	});
});
