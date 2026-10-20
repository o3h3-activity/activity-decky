import type {
	GameIdentityRequest,
	GameIdentityResult,
} from "@api/discIdentity";
import type { AppDetails } from "@decky/ui/dist/globals/steam-client/App";
import { TimeoutError } from "es-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	identities:
		vi.fn<(games: GameIdentityRequest[]) => Promise<GameIdentityResult[]>>(),
}));

vi.mock(
	import("@api/discIdentity"),
	() => ({ getGameIdentities: mocks.identities }) as never,
);

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: {
				debug: vi.fn<() => void>(),
				error: vi.fn<() => void>(),
				info: vi.fn<() => void>(),
			},
		}) as never,
);

import { Game } from "./game";
import { Identity } from "./identity";

type ShortcutDetails = Pick<
	AppDetails,
	"strShortcutExe" | "strShortcutLaunchOptions" | "strShortcutStartDir"
>;

type RequestAppDetails = () => Promise<Nullable<ShortcutDetails>>;

const SHORTCUT_ID = 10;
const OTHER_SHORTCUT_ID = 11;

const FINAL_FANTASY_PATH =
	"/run/media/mmcblk0p1/Emulation/roms/psx/Final Fantasy VII (Disc 1).cue";
const ICO_PATH = "/home/deck/Emulation/roms/ps2/Ico.iso";
const ICO_MD5 = "0123456789abcdef0123456789abcdef";

const RETROARCH_SHORTCUT: ShortcutDetails = {
	strShortcutExe: '"/usr/bin/flatpak"',
	strShortcutLaunchOptions:
		'run org.libretro.RetroArch -L /home/deck/.var/app/org.libretro.RetroArch/config/retroarch/cores/swanstation_libretro.so "/run/media/mmcblk0p1/Emulation/roms/psx/Final Fantasy VII (Disc 1).cue"',
	strShortcutStartDir: '"/usr/bin/"',
};

const RELATIVE_ROM_SHORTCUT: ShortcutDetails = {
	strShortcutExe: '"/usr/bin/pcsx2-qt"',
	strShortcutLaunchOptions: '-batch -fullscreen "Ico.iso"',
	strShortcutStartDir: '"/home/deck/Emulation/roms/ps2"',
};

const BROWSER_SHORTCUT: ShortcutDetails = {
	strShortcutExe: '"/usr/bin/flatpak"',
	strShortcutLaunchOptions: "run org.mozilla.firefox",
	strShortcutStartDir: '"/usr/bin/"',
};

function stubShortcut(request: RequestAppDetails): void {
	vi.stubGlobal("window", {
		appDetailsStore: {
			RequestAppDetails: async (appId: number) =>
				appId === SHORTCUT_ID ? request() : undefined,
		},
	});
}

beforeEach(() => {
	mocks.identities.mockReset();
	// Like the backend, only identifiable discs (Ico's) are returned; other paths are omitted.
	mocks.identities.mockImplementation(async (games) =>
		games.flatMap(({ appId, path }) =>
			path === ICO_PATH
				? [
						{
							appId,
							game_identity_md5: ICO_MD5,
							platform: "ps2",
							rcheevos_id: 21,
							serial: "SCUS-97113",
						},
					]
				: [],
		),
	);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("Identity.locate", () => {
	it("finds the ROM a launcher passes as an absolute path", async () => {
		stubShortcut(async () => RETROARCH_SHORTCUT);

		await expect(new Identity().locate(SHORTCUT_ID)).resolves.toBe(
			FINAL_FANTASY_PATH,
		);
	});

	it("finds a ROM named relative to the shortcut's start directory", async () => {
		stubShortcut(async () => RELATIVE_ROM_SHORTCUT);

		await expect(new Identity().locate(SHORTCUT_ID)).resolves.toBe(ICO_PATH);
	});

	it("finds no ROM in a shortcut that launches none", async () => {
		stubShortcut(async () => BROWSER_SHORTCUT);

		await expect(new Identity().locate(SHORTCUT_ID)).resolves.toBeUndefined();
	});

	it.each<[string, RequestAppDetails, string]>([
		[
			"has no details",
			async () => undefined,
			`Steam has no details for shortcut ${SHORTCUT_ID}`,
		],
		[
			"cannot be read",
			async () => {
				throw new Error("RequestAppDetails failed");
			},
			"RequestAppDetails failed",
		],
	])(
		"rejects when the shortcut %s, so callers can ask again",
		async (_, request, message) => {
			stubShortcut(request);

			await expect(new Identity().locate(SHORTCUT_ID)).rejects.toThrow(message);
		},
	);

	it("gives up on details Steam never answers", async () => {
		vi.useFakeTimers();
		const { promise: unanswered } = Promise.withResolvers<ShortcutDetails>();

		stubShortcut(async () => unanswered);
		const lookup = new Identity()
			.locate(SHORTCUT_ID)
			.catch((error: unknown) => error);

		await vi.runAllTimersAsync();

		await expect(lookup).resolves.toBeInstanceOf(TimeoutError);
	});
});

describe("Identity.identify", () => {
	it("attaches the disc the backend identifies and leaves the others unidentified", async () => {
		const [ico, finalFantasy] = await new Identity().identify([
			Game.launching(SHORTCUT_ID, ICO_PATH),
			Game.launching(OTHER_SHORTCUT_ID, FINAL_FANTASY_PATH),
		]);

		expect(ico.disc?.md5).toBe(ICO_MD5);
		expect(ico.disc?.serial).toBe("SCUS-97113");
		expect(finalFantasy.romPath).toBe(FINAL_FANTASY_PATH);
		expect(finalFantasy.disc).toBeUndefined();
	});

	it("rejects when the backend cannot be reached, so callers can ask again", async () => {
		mocks.identities.mockRejectedValue(new Error("backend unreachable"));

		await expect(
			new Identity().identify([Game.launching(SHORTCUT_ID, ICO_PATH)]),
		).rejects.toThrow("backend unreachable");
	});
});
