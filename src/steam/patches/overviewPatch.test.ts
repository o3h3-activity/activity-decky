/* oxlint-disable vitest/prefer-strict-boolean-matchers -- Conflicts with the required prefer-to-be-truthy/falsy rules. */
import { EAppType } from "@decky/ui/dist/globals/steam-client/App";
import type { Games } from "@steam/games";
import { afterEach, describe, expect, it, vi } from "vitest";

type Method = (this: unknown, ...args: unknown[]) => unknown;

vi.mock(import("@decky/ui"), () => {
	const callOriginal = Symbol("callOriginal");

	return {
		callOriginal,
		replacePatch: (
			target: Record<string, Method>,
			method: string,
			callback: Method,
		) => {
			const original = target[method];

			target[method] = function (this: unknown, ...args: unknown[]) {
				const result = callback.call(this, args);

				return result === callOriginal ? original.apply(this, args) : result;
			};

			return {
				original,
				unpatch: () => {
					target[method] = original;
				},
			};
		},
		afterPatch: (
			target: Record<string, Method>,
			method: string,
			callback: Method,
		) => {
			const original = target[method];

			target[method] = function (this: unknown, ...args: unknown[]) {
				return callback.call(this, args, original.apply(this, args));
			};

			return {
				original,
				unpatch: () => {
					target[method] = original;
				},
			};
		},
	} as never;
});

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: {
				debug: vi.fn<() => void>(),
				once: { debug: vi.fn<() => void>(), info: vi.fn<() => void>() },
			},
		}) as never,
);

import { OverviewPatch } from "./overviewPatch";

const SUPPORTED_ID = 10;
const UNSUPPORTED_ID = 11;
const NATIVE_ID = 12;
const SHORTCUT_PRIMARY_ID = 4095;

class Overview {
	readonly display_name = "Shortcut";
	readonly m_gameid = "123456789012345";
	readonly m_ulGameId = { low: 8191 };
	constructor(
		readonly appid: number,
		readonly app_type = EAppType.Shortcut,
	) {}

	BIsModOrShortcut(): boolean {
		return this.app_type === EAppType.Shortcut;
	}

	GetGameID(): string {
		return this.BIsModOrShortcut() ? this.m_gameid : String(this.appid);
	}

	GetPrimaryAppID(): number {
		return this.BIsModOrShortcut() ? SHORTCUT_PRIMARY_ID : this.appid;
	}
}

let patch: OverviewPatch | undefined;

afterEach(() => {
	patch?.unMount();
	vi.unstubAllGlobals();
});

describe("OverviewPatch eligibility", () => {
	it("unlocks only the identified app ID and preserves shortcut launch IDs", () => {
		const supported = new Overview(SUPPORTED_ID);
		const unsupported = new Overview(UNSUPPORTED_ID);
		const native = new Overview(NATIVE_ID, EAppType.Game);

		vi.stubGlobal("window", { appStore: { allApps: [supported] } });
		const games = {
			isSupported: (appId: number): boolean =>
				appId === SUPPORTED_ID || appId === NATIVE_ID,
		} as unknown as Games;

		patch = new OverviewPatch(games);

		expect(supported.BIsModOrShortcut()).toBeFalsy();
		expect(supported.GetGameID()).toBe("123456789012345");
		expect(supported.GetPrimaryAppID()).toBe(SHORTCUT_PRIMARY_ID);
		expect(unsupported.BIsModOrShortcut()).toBeTruthy();
		expect(unsupported.GetGameID()).toBe("123456789012345");
		expect(unsupported.GetPrimaryAppID()).toBe(SHORTCUT_PRIMARY_ID);
		expect(native.BIsModOrShortcut()).toBeFalsy();
		expect(native.GetGameID()).toBe("12");
		expect(native.GetPrimaryAppID()).toBe(NATIVE_ID);
	});
});
