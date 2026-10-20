import { callOriginal, replacePatch } from "@decky/ui/dist/utils/patcher.js";
import {
	clanAccountIdFromAppId,
	ShortcutClanRegistry,
} from "@steam/patches/shortcuts/clanIdentity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_EVENT_CAPSULE } from "./eventImages";
import { ShortcutClanImagePatch } from "./shortcutClanImagePatch";

const mocks = vi.hoisted(() => ({
	helper: {
		GetBaseURL: () => "https://clan.steamstatic.com/images/",
		GenerateURLFromHashAndExt(...args: unknown[]): unknown {
			return { baseURL: this.GetBaseURL(), args };
		},
		GenerateURLFromHashAndExtAndLang(...args: unknown[]): unknown {
			return { baseURL: this.GetBaseURL(), args };
		},
	},
}));

vi.mock(
	import("@decky/ui"),
	() =>
		({
			callOriginal,
			replacePatch,
			findModuleExport: (predicate: (value: unknown) => boolean) =>
				[undefined, {}, mocks.helper].find(predicate),
		}) as never,
);

const IMAGE_METHODS = [
	"GenerateURLFromHashAndExt",
	"GenerateURLFromHashAndExtAndLang",
] as const;
const APP_ID = 42;
const CLAN_ACCOUNT_ID = clanAccountIdFromAppId(APP_ID);
const OFFICIAL_CLAN_ACCOUNT_ID = 43_808_803;
let patch: ShortcutClanImagePatch;
let registry: ShortcutClanRegistry;

beforeEach(() => {
	vi.spyOn(console, "debug").mockImplementation(() => undefined);
	registry = new ShortcutClanRegistry();
	patch = new ShortcutClanImagePatch(registry);
});

afterEach(() => {
	patch.unMount();
	vi.restoreAllMocks();
});

describe("shortcut clan image compatibility", () => {
	it("uses live registration for numeric and SteamID arguments without changing official images", () => {
		const shortcutSteamId = {
			accountId: CLAN_ACCOUNT_ID,
			GetAccountID() {
				return this.accountId;
			},
		};
		const officialSteamId = { GetAccountID: () => OFFICIAL_CLAN_ACCOUNT_ID };

		for (const method of IMAGE_METHODS) {
			expect(
				mocks.helper[method](CLAN_ACCOUNT_ID, "hash", "jpg", "en"),
			).toEqual({
				baseURL: mocks.helper.GetBaseURL(),
				args: [CLAN_ACCOUNT_ID, "hash", "jpg", "en"],
			});
		}

		registry.registerApp(APP_ID);

		for (const method of IMAGE_METHODS) {
			for (const clan of [CLAN_ACCOUNT_ID, shortcutSteamId]) {
				expect(mocks.helper[method](clan, "hash", "jpg", "en")).toBe(
					SAMPLE_EVENT_CAPSULE,
				);
			}

			for (const clan of [OFFICIAL_CLAN_ACCOUNT_ID, officialSteamId]) {
				expect(mocks.helper[method](clan, "hash", "jpg", "en")).toEqual({
					baseURL: mocks.helper.GetBaseURL(),
					args: [clan, "hash", "jpg", "en"],
				});
			}
		}
	});

	it("leaves unsupported clan arguments to Steam", () => {
		registry.registerApp(APP_ID);

		for (const method of IMAGE_METHODS) {
			for (const clan of [
				undefined,
				String(CLAN_ACCOUNT_ID),
				Number.NaN,
				Number.POSITIVE_INFINITY,
				{},
				{ GetAccountID: CLAN_ACCOUNT_ID },
				{ GetAccountID: () => String(CLAN_ACCOUNT_ID) },
				{ GetAccountID: () => Number.NaN },
			]) {
				expect(mocks.helper[method](clan, "hash", "jpg")).toEqual({
					baseURL: mocks.helper.GetBaseURL(),
					args: [clan, "hash", "jpg"],
				});
			}
		}
	});

	it("restores native generation on logout and does not reuse the previous session registry", () => {
		registry.registerApp(APP_ID);
		patch.unMount();
		patch.unMount();

		for (const method of IMAGE_METHODS) {
			expect(mocks.helper[method](CLAN_ACCOUNT_ID, "hash", "jpg")).toEqual({
				baseURL: mocks.helper.GetBaseURL(),
				args: [CLAN_ACCOUNT_ID, "hash", "jpg"],
			});
		}

		patch = new ShortcutClanImagePatch(new ShortcutClanRegistry());

		for (const method of IMAGE_METHODS) {
			expect(mocks.helper[method](CLAN_ACCOUNT_ID, "hash", "jpg")).toEqual({
				baseURL: mocks.helper.GetBaseURL(),
				args: [CLAN_ACCOUNT_ID, "hash", "jpg"],
			});
		}
	});
});
