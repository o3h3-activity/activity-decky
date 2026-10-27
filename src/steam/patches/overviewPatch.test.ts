/* oxlint-disable vitest/prefer-strict-boolean-matchers -- Conflicts with the required prefer-to-be-truthy/falsy rules. */
import { EAppType } from "@decky/ui/dist/globals/steam-client/App";
import type { Games } from "@steam/games";
import { isNil } from "es-toolkit";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";

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
// oxlint-disable-next-line unicorn/no-null -- Steam returns null until the icon data arrives.
const NULL_ICON = null;

interface PreservedIconState {
	icon_data: string;
	icon_data_format?: string;
}

interface OverviewHarness {
	requestIcon: Mock<(appId: number) => void>;
	store: {
		allApps: Overview[];
		GetIconURLForApp(overview?: Overview): null | string;
	};
	supportedIds: Set<number>;
}

class Overview {
	readonly display_name = "Shortcut";
	readonly m_gameid = "123456789012345";
	readonly m_ulGameId = { low: 8191 };
	icon_hash?: string;
	icon_data?: null | string;
	icon_data_format?: string;
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

	GetPreservedState(): PreservedIconState | undefined {
		if (
			this.BIsModOrShortcut() &&
			!isNil(this.icon_data) &&
			this.icon_data.length > 0
		) {
			return {
				icon_data: this.icon_data,
				icon_data_format: this.icon_data_format,
			};
		}

		return undefined;
	}

	RestorePreservedState(state: PreservedIconState | undefined): void {
		if (state?.icon_data && isNil(this.icon_data)) {
			this.icon_data = state.icon_data;
			this.icon_data_format = state.icon_data_format;
		}
	}
}

let patch: OverviewPatch | undefined;

function mount(
	overviews: Overview[],
	supportedIds = new Set([SUPPORTED_ID, NATIVE_ID]),
): OverviewHarness {
	const requestIcon = vi.fn<(appId: number) => void>();
	const store = {
		allApps: overviews,
		GetIconURLForApp(overview?: Overview): null | string {
			if (isNil(overview)) {
				return NULL_ICON;
			}

			if (overview.icon_hash) {
				return `https://community.invalid/images/apps/${overview.appid}/${overview.icon_hash}.jpg`;
			}

			if (overview.icon_data) {
				return `data:image/${overview.icon_data_format};base64,${overview.icon_data}`;
			}

			if (overview.BIsModOrShortcut() && isNil(overview.icon_data)) {
				SteamClient.Apps.RequestIconDataForApp(overview.appid);
			}

			return NULL_ICON;
		},
	};

	vi.stubGlobal("window", { appStore: store });
	vi.stubGlobal("SteamClient", {
		Apps: { RequestIconDataForApp: requestIcon },
	});

	patch = new OverviewPatch({
		isSupported: (appId: number): boolean => supportedIds.has(appId),
	} as unknown as Games);

	return { store, requestIcon, supportedIds };
}

afterEach(() => {
	patch?.unMount();
	vi.unstubAllGlobals();
});

describe("OverviewPatch eligibility", () => {
	it("unlocks only the identified app ID and preserves shortcut launch IDs", () => {
		const supported = new Overview(SUPPORTED_ID);
		const unsupported = new Overview(UNSUPPORTED_ID);
		const native = new Overview(NATIVE_ID, EAppType.Game);

		mount([supported, unsupported, native]);

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

describe("OverviewPatch icons", () => {
	it.each([undefined, NULL_ICON])(
		"loads a supported shortcut icon when its data is %s",
		(iconData) => {
			const supported = new Overview(SUPPORTED_ID);

			supported.icon_data = iconData;
			const { store, requestIcon } = mount([supported]);

			expect(store.GetIconURLForApp(supported)).toBeNull();
			expect(requestIcon).toHaveBeenCalledExactlyOnceWith(SUPPORTED_ID);
			expect(supported.GetPreservedState()).toBeUndefined();

			supported.icon_data = "aWNvbg==";
			supported.icon_data_format = "png";

			expect(store.GetIconURLForApp(supported)).toBe(
				"data:image/png;base64,aWNvbg==",
			);

			expect(requestIcon).toHaveBeenCalledOnce();
		},
	);

	it("keeps existing icon URLs and does not retry empty icon data", () => {
		const supported = new Overview(SUPPORTED_ID);
		const { store, requestIcon } = mount([supported]);

		supported.icon_hash = "existing-icon";
		expect(store.GetIconURLForApp(supported)).toBe(
			`https://community.invalid/images/apps/${SUPPORTED_ID}/existing-icon.jpg`,
		);

		supported.icon_hash = undefined;
		supported.icon_data = "";
		expect(store.GetIconURLForApp(supported)).toBeNull();
		expect(supported.GetPreservedState()).toBeUndefined();
		expect(store.GetIconURLForApp()).toBeNull();
		expect(requestIcon).not.toHaveBeenCalled();
	});

	it("leaves unsupported shortcuts and native apps on Steam's icon path", () => {
		const unsupported = new Overview(UNSUPPORTED_ID);
		const native = new Overview(NATIVE_ID, EAppType.Game);
		const { store, requestIcon } = mount([unsupported, native]);

		store.GetIconURLForApp(unsupported);
		store.GetIconURLForApp(native);

		expect(requestIcon).toHaveBeenCalledExactlyOnceWith(UNSUPPORTED_ID);
		native.icon_data = "native-icon";
		expect(native.GetPreservedState()).toBeUndefined();
	});

	it("loads icons for shortcuts recognized after mounting", () => {
		const supported = new Overview(SUPPORTED_ID);
		const { store, requestIcon, supportedIds } = mount(
			[supported],
			new Set<number>(),
		);

		store.GetIconURLForApp(supported);
		expect(requestIcon).toHaveBeenCalledExactlyOnceWith(SUPPORTED_ID);
		requestIcon.mockClear();
		supportedIds.add(SUPPORTED_ID);

		expect(supported.BIsModOrShortcut()).toBeFalsy();
		store.GetIconURLForApp(supported);
		expect(requestIcon).toHaveBeenCalledExactlyOnceWith(SUPPORTED_ID);
	});

	it("retains loaded shortcut icons when Steam replaces the overview", () => {
		const supported = new Overview(SUPPORTED_ID);
		const unsupported = new Overview(UNSUPPORTED_ID);

		supported.icon_data = "c3VwcG9ydGVk";
		supported.icon_data_format = "png";
		unsupported.icon_data = "dW5zdXBwb3J0ZWQ=";
		unsupported.icon_data_format = "jpeg";
		const { store, requestIcon } = mount([supported, unsupported]);

		const refreshedSupported = new Overview(SUPPORTED_ID);
		const refreshedUnsupported = new Overview(UNSUPPORTED_ID);

		refreshedSupported.RestorePreservedState(supported.GetPreservedState());
		refreshedUnsupported.RestorePreservedState(unsupported.GetPreservedState());
		store.allApps = [refreshedSupported, refreshedUnsupported];

		expect(store.GetIconURLForApp(refreshedSupported)).toBe(
			"data:image/png;base64,c3VwcG9ydGVk",
		);

		expect(store.GetIconURLForApp(refreshedUnsupported)).toBe(
			"data:image/jpeg;base64,dW5zdXBwb3J0ZWQ=",
		);

		expect(requestIcon).not.toHaveBeenCalled();
	});

	it("restores Steam's shortcut icon loading without duplicate requests on unmount", () => {
		const supported = new Overview(SUPPORTED_ID);
		const { store, requestIcon } = mount([supported]);

		patch?.unMount();
		patch = undefined;
		expect(supported.BIsModOrShortcut()).toBeTruthy();
		store.GetIconURLForApp(supported);
		expect(requestIcon).toHaveBeenCalledExactlyOnceWith(SUPPORTED_ID);
	});
});
