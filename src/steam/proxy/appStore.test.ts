import { EAppType } from "@decky/ui/dist/globals/steam-client/App";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppStore } from "./appStore";

const SHORTCUT_A_ID = 10;
const NATIVE_GAME_ID = 20;
const MOD_ID = 30;
const SHORTCUT_B_ID = 40;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("AppStore.getShortcutAppIds", () => {
	it("enumerates shortcuts across the store without native games or mods", () => {
		vi.stubGlobal("window", {
			appStore: {
				m_mapApps: new Map([
					[
						SHORTCUT_A_ID,
						{ app_type: EAppType.Shortcut, third_party_mod: false },
					],
					[NATIVE_GAME_ID, { app_type: EAppType.Game, third_party_mod: false }],
					[MOD_ID, { app_type: EAppType.Shortcut, third_party_mod: true }],
					[
						SHORTCUT_B_ID,
						{ app_type: EAppType.Shortcut, third_party_mod: false },
					],
				]),
			},
		});

		expect(AppStore.getShortcutAppIds()).toEqual([
			SHORTCUT_A_ID,
			SHORTCUT_B_ID,
		]);
	});

	it("distinguishes an unavailable store from an empty shortcut library", () => {
		vi.stubGlobal("window", { appStore: undefined });
		expect(AppStore.getShortcutAppIds()).toBeUndefined();

		vi.stubGlobal("window", { appStore: { m_mapApps: new Map() } });
		expect(AppStore.getShortcutAppIds()).toEqual([]);
	});
});
