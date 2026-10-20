import {
	findGamePath,
	tokenizeLaunchCommand,
} from "@steam/utils/launchCommand";
import { describe, expect, it } from "vitest";

describe("tokenizeLaunchCommand", () => {
	const cases: Array<[label: string, command: string, expected: string[]]> = [
		[
			"double quotes group paths with spaces",
			'"/home/deck/launchers/pcsx2.sh" -batch "/roms/ps2/God of War.iso"',
			["/home/deck/launchers/pcsx2.sh", "-batch", "/roms/ps2/God of War.iso"],
		],
		[
			"single quotes are literal",
			String.raw`'/roms/First Game.cue' '/roms/a\b "c".iso'`,
			["/roms/First Game.cue", String.raw`/roms/a\b "c".iso`],
		],
		[
			"quotes in the middle of an argument are removed",
			'--rom="/roms/a b.iso" WINEDLLOVERRIDES="d3d9=n,b" %command%',
			["--rom=/roms/a b.iso", "WINEDLLOVERRIDES=d3d9=n,b", "%command%"],
		],
		[
			"backslashes escape outside quotes and only special characters inside double quotes",
			String.raw`/roms/Game\ One.iso "/roms/Say \"Hi\".iso" "Z:\games\x.iso"`,
			["/roms/Game One.iso", '/roms/Say "Hi".iso', String.raw`Z:\games\x.iso`],
		],
		["empty quoted arguments are kept", '/bin/app "" x', ["/bin/app", "", "x"]],
		["a blank command has no arguments", "   ", []],
	];

	it.each(cases)("%s", (_label, command, expected) => {
		expect(tokenizeLaunchCommand(command)).toEqual(expected);
	});
});

describe("findGamePath", () => {
	const extensions = new Set([".cue", ".iso", ".pbp"]);

	const cases: Array<
		[label: string, command: string, startDir: string, expected: string]
	> = [
		[
			"quoted EmuDeck ROM with parentheses and spaces",
			'"/home/deck/EmuDeckROM/Emulation/tools/launchers/duckstation.sh" -batch -fullscreen -nogui "/home/deck/EmuDeckROM/Emulation/roms/psx/Ace Combat 3 (Disc 1)/Ace Combat 3 (Disc 1).cue" ',
			"",
			"/home/deck/EmuDeckROM/Emulation/roms/psx/Ace Combat 3 (Disc 1)/Ace Combat 3 (Disc 1).cue",
		],
		[
			"absolute paths around the ROM are ignored",
			'"/usr/bin/retroarch" -L /cores/pcsx2_libretro.so --config "/home/deck/ra.cfg" "/roms/ps2/Game.iso" --log-file /tmp/ra.log',
			"",
			"/roms/ps2/Game.iso",
		],
		[
			"env assignments and %command% before a single-quoted ROM",
			"\"/home/deck/launchers/pcsx2.sh\" vblank_mode=0 %command% -f '/home/deck/roms/First Game.cue'",
			"",
			"/home/deck/roms/First Game.cue",
		],
		[
			"ROM passed as a flag value",
			'"/usr/bin/ppsspp" --game="/roms/psp/Tony Hawk.pbp"',
			"",
			"/roms/psp/Tony Hawk.pbp",
		],
		[
			"relative ROM resolves against the quoted start directory",
			'"/usr/bin/retroarch" -L cores/pcsx2_libretro.so "roms/ps2/Game.iso"',
			'"/home/deck/Emulation/"',
			"/home/deck/Emulation/roms/ps2/Game.iso",
		],
		[
			"home-relative ROM is left for the backend to expand",
			'"/usr/bin/pcsx2" ~/roms/Game.iso',
			"",
			"~/roms/Game.iso",
		],
		[
			"Wine Z: drive paths map to the Linux root",
			String.raw`"/home/deck/Games/launcher.exe" "Z:\home\deck\roms\Game.iso"`,
			"",
			"/home/deck/roms/Game.iso",
		],
		[
			"extension match is case-insensitive",
			'"/usr/bin/pcsx2" "/roms/GAME.ISO"',
			"",
			"/roms/GAME.ISO",
		],
	];

	it.each(cases)("%s", (_label, command, startDir, expected) => {
		expect(findGamePath(command, { extensions, startDir })).toBe(expected);
	});

	it.each([
		[
			"flatpak app without a ROM",
			'"/usr/bin/flatpak" "run" "--command=moonlight" "com.moonlight_stream.Moonlight"',
		],
		["Heroic URL shortcut", "xdg-open heroic://launch/gog/1207658924"],
		[
			"relative ROM without a start directory",
			'"/usr/bin/pcsx2" roms/Game.iso',
		],
		["unsupported ROM format", '"/usr/bin/ppsspp" "/roms/psp/Game.cso"'],
		["blank command", "   "],
	])("returns undefined for %s", (_label, command) => {
		expect(findGamePath(command, { extensions })).toBeUndefined();
	});
});
