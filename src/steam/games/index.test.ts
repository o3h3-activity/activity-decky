/* oxlint-disable vitest/prefer-strict-boolean-matchers -- Conflicts with the required prefer-to-be-truthy/falsy rules. */
import {
	type GameRecognitionResult,
	RECOGNITION_BATCH_SIZE,
} from "@api/catalog";
import type { GameIdentityResult } from "@api/discIdentity";
import type { GameSyncListener } from "@stores/gameSync";
import { sum } from "es-toolkit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	batches:
		vi.fn<
			(identities: GameIdentityResult[]) => Promise<GameRecognitionResult[]>
		>(),
	recognitions:
		vi.fn<
			(identities: GameIdentityResult[]) => Promise<GameRecognitionResult[]>
		>(),
}));

vi.mock(
	import("@api/catalog"),
	() =>
		({
			RECOGNITION_BATCH_SIZE: 256,
			recognizeGameBatch: mocks.batches,
			recognizeGames: mocks.recognitions,
		}) as never,
);

// Games receives a FakeIdentity; the real Identity module's RPC import only has to resolve.
vi.mock(import("@api/discIdentity"), () => ({}) as never);

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

import { DiscIdentity, type Game } from "./game";
import { Games } from "./index";

type CatalogAnswer = Omit<GameRecognitionResult, "gameIdentityMd5">;

const ICO_ID = 10;
const FINAL_FANTASY_ID = 11;
const BROWSER_ID = 12;
const SHORTCUTS = [ICO_ID, FINAL_FANTASY_ID, BROWSER_ID];

const ICO_PATH = "/home/deck/Emulation/roms/ps2/Ico.iso";
const FINAL_FANTASY_PATH =
	"/run/media/mmcblk0p1/Emulation/roms/psx/Final Fantasy VII (Disc 1).cue";
const ICO_MD5 = "0123456789abcdef0123456789abcdef";

const ICO_DISC = DiscIdentity.fromResult({
	appId: ICO_ID,
	game_identity_md5: ICO_MD5,
	platform: "ps2",
	rcheevos_id: 21,
	serial: "SCUS-97113",
});

const ICO_RELEASE: CatalogAnswer = {
	gameId: "game-ico",
	releaseId: "release-ico",
	releaseRevisionId: "revision-ico-us",
};

class FakeIdentity {
	shortcuts: readonly number[] | undefined = SHORTCUTS;

	readonly locate = vi.fn<(appId: number) => Promise<string | undefined>>(
		async (appId) => FakeIdentity.ROMS.get(appId),
	);

	/** Only Ico's disc is identifiable, like an unsupported or unreadable image. */
	readonly identify = vi.fn<(games: readonly Game[]) => Promise<Game[]>>(
		async (games) =>
			games.map((game) =>
				game.romPath === ICO_PATH ? game.identifiedAs(ICO_DISC) : game,
			),
	);

	private static readonly ROMS = new Map([
		[ICO_ID, ICO_PATH],
		[FINAL_FANTASY_ID, FINAL_FANTASY_PATH],
	]);

	shortcutAppIds(): readonly number[] | undefined {
		return this.shortcuts;
	}
}

function answerForIco(
	answer: CatalogAnswer,
): (identities: GameIdentityResult[]) => Promise<GameRecognitionResult[]> {
	return async (identities) =>
		identities.flatMap(({ game_identity_md5 }) =>
			game_identity_md5 === ICO_MD5
				? [{ gameIdentityMd5: game_identity_md5, ...answer }]
				: [],
		);
}

async function answerAll(
	identities: GameIdentityResult[],
): Promise<GameRecognitionResult[]> {
	return identities.map(({ game_identity_md5 }) => ({
		gameIdentityMd5: game_identity_md5,
		...ICO_RELEASE,
	}));
}

let identity: FakeIdentity;

beforeEach(() => {
	identity = new FakeIdentity();
	mocks.recognitions.mockReset();
	mocks.recognitions.mockResolvedValue([]);
	mocks.batches.mockReset();
	mocks.batches.mockResolvedValue([]);
});

describe("Games.isSupported", () => {
	it("allows only app IDs with a backend disc identity, without requiring a catalog release", async () => {
		const games = new Games(identity);

		await games.mount();

		expect(games.isSupported(ICO_ID)).toBeTruthy();
		expect(games.isSupported(FINAL_FANTASY_ID)).toBeFalsy();
		expect(games.isSupported(BROWSER_ID)).toBeFalsy();
	});

	it("blocks an unknown ID while identifying it, then allows its confirmed identity", async () => {
		const games = new Games(identity);
		const { promise, resolve } = Promise.withResolvers<string | undefined>();

		identity.locate.mockReturnValueOnce(promise);

		expect(games.isSupported(ICO_ID)).toBeFalsy();
		resolve(ICO_PATH);
		await games.get(ICO_ID);

		expect(games.isSupported(ICO_ID)).toBeTruthy();
	});

	it("revokes eligibility when the session ends", async () => {
		const games = new Games(identity);

		await games.mount();

		games.unMount();

		expect(games.isSupported(ICO_ID)).toBeFalsy();
	});
});

describe("Games.get", () => {
	it("returns the ROM game a shortcut launches, with its disc", async () => {
		const game = await new Games(identity).get(ICO_ID);

		expect(game?.appId).toBe(ICO_ID);
		expect(game?.romPath).toBe(ICO_PATH);
		expect(game?.disc?.md5).toBe(ICO_MD5);
	});

	it("keeps a ROM game whose disc the backend cannot identify", async () => {
		const game = await new Games(identity).get(FINAL_FANTASY_ID);

		expect(game?.romPath).toBe(FINAL_FANTASY_PATH);
		expect(game?.disc).toBeUndefined();
	});

	it("reads each shortcut from Steam once per session", async () => {
		const games = new Games(identity);

		await games.get(ICO_ID);
		await games.get(ICO_ID);

		expect(identity.locate).toHaveBeenCalledOnce();
	});

	it("shares one Steam read between concurrent lookups", async () => {
		const games = new Games(identity);

		const [first, second] = await Promise.all([
			games.get(ICO_ID),
			games.get(ICO_ID),
		]);

		expect(first).toBe(second);
		expect(identity.locate).toHaveBeenCalledOnce();
	});

	it("batches concurrent shortcut lookups even when Steam answers at different times", async () => {
		const games = new Games(identity);
		const { promise, resolve } = Promise.withResolvers<string | undefined>();

		identity.locate.mockReturnValueOnce(promise);
		const ico = games.get(ICO_ID);
		const finalFantasy = games.get(FINAL_FANTASY_ID);

		await vi.waitFor(() => {
			expect(identity.locate).toHaveBeenCalledTimes(2);
		});

		expect(identity.identify).not.toHaveBeenCalled();

		resolve(ICO_PATH);
		const [first, second] = await Promise.all([ico, finalFantasy]);

		expect(first?.disc?.md5).toBe(ICO_MD5);
		expect(second?.romPath).toBe(FINAL_FANTASY_PATH);
		expect(identity.identify).toHaveBeenCalledOnce();
		expect(
			identity.identify.mock.calls[0][0].map(({ appId }) => appId),
		).toEqual([ICO_ID, FINAL_FANTASY_ID]);
	});

	it("retries every shortcut in a failed batch on the next concurrent lookups", async () => {
		identity.identify.mockRejectedValueOnce(new Error("backend unreachable"));
		const games = new Games(identity);

		await expect(
			Promise.all([games.get(ICO_ID), games.get(FINAL_FANTASY_ID)]),
		).resolves.toEqual([undefined, undefined]);

		const [ico, finalFantasy] = await Promise.all([
			games.get(ICO_ID),
			games.get(FINAL_FANTASY_ID),
		]);

		expect(ico?.disc?.md5).toBe(ICO_MD5);
		expect(finalFantasy?.romPath).toBe(FINAL_FANTASY_PATH);
		expect(identity.identify).toHaveBeenCalledTimes(2);
	});

	it("remembers a shortcut that launches no ROM", async () => {
		const games = new Games(identity);

		await expect(games.get(BROWSER_ID)).resolves.toBeUndefined();
		await expect(games.get(BROWSER_ID)).resolves.toBeUndefined();

		expect(identity.locate).toHaveBeenCalledOnce();
	});

	it("asks Steam again after a failed read", async () => {
		identity.locate.mockRejectedValueOnce(new Error("details timed out"));
		const games = new Games(identity);

		await expect(games.get(ICO_ID)).resolves.toBeUndefined();

		const game = await games.get(ICO_ID);

		expect(game?.romPath).toBe(ICO_PATH);
	});

	it("asks the backend again after it failed to identify", async () => {
		identity.identify.mockRejectedValueOnce(new Error("backend unreachable"));
		const games = new Games(identity);

		await expect(games.get(ICO_ID)).resolves.toBeUndefined();

		const game = await games.get(ICO_ID);

		expect(game?.disc?.md5).toBe(ICO_MD5);
	});

	it("does not ask Activity's catalog", async () => {
		await new Games(identity).get(ICO_ID);

		expect(mocks.recognitions).not.toHaveBeenCalled();
	});

	it("drops a lookup that finishes after unmount", async () => {
		const { promise: steamRead, resolve } = Promise.withResolvers<
			string | undefined
		>();

		identity.locate.mockReturnValueOnce(steamRead);
		const games = new Games(identity);
		const lookup = games.get(ICO_ID);

		await vi.waitFor(() => {
			expect(identity.locate).toHaveBeenCalledOnce();
		});

		games.unMount();
		resolve(ICO_PATH);

		await expect(lookup).resolves.toBeUndefined();
		await expect(games.get(ICO_ID)).resolves.toBeUndefined();
	});

	it("does not start queued lookups after unmount", async () => {
		const games = new Games(identity);
		const lookup = games.get(ICO_ID);

		games.unMount();

		await expect(lookup).resolves.toBeUndefined();
		expect(identity.locate).not.toHaveBeenCalled();
		expect(identity.identify).not.toHaveBeenCalled();
	});
});

describe("Games.mount", () => {
	it("identifies every shortcut's disc in one backend batch", async () => {
		const games = new Games(identity);

		await games.mount();

		expect(identity.identify).toHaveBeenCalledOnce();
		expect(
			identity.identify.mock.calls[0][0].map(({ appId }) => appId),
		).toEqual([ICO_ID, FINAL_FANTASY_ID]);
	});

	it("combines an early lookup with the startup preload", async () => {
		const games = new Games(identity);
		const lookup = games.get(ICO_ID);

		await games.mount();

		const game = await lookup;

		expect(game?.disc?.md5).toBe(ICO_MD5);
		expect(identity.locate).toHaveBeenCalledTimes(SHORTCUTS.length);
		expect(identity.identify).toHaveBeenCalledOnce();
		expect(
			identity.identify.mock.calls[0][0].map(({ appId }) => appId),
		).toEqual([ICO_ID, FINAL_FANTASY_ID]);
	});

	it("serves later lookups without asking Steam again", async () => {
		const games = new Games(identity);

		await games.mount();
		await games.get(ICO_ID);
		await games.get(BROWSER_ID);

		expect(identity.locate).toHaveBeenCalledTimes(SHORTCUTS.length);
	});

	it("finds a shortcut added after mount", async () => {
		identity.shortcuts = [FINAL_FANTASY_ID];
		const games = new Games(identity);

		await games.mount();

		const game = await games.get(ICO_ID);

		expect(game?.disc?.md5).toBe(ICO_MD5);
	});
});

describe("Games.getRelease", () => {
	it("returns the Activity release of the disc the shortcut launches", async () => {
		mocks.recognitions.mockImplementation(answerForIco(ICO_RELEASE));

		const release = await new Games(identity).getRelease(ICO_ID);

		expect(release?.gameId).toBe("game-ico");
		expect(release?.releaseId).toBe("release-ico");
		expect(release?.revisionId).toBe("revision-ico-us");
	});

	it("keeps a recognised revision whose release Activity has not published", async () => {
		mocks.recognitions.mockImplementation(
			// oxlint-disable-next-line unicorn/no-null -- `recognize_games` reports an unpublished release as null.
			answerForIco({
				gameId: "game-ico",
				// oxlint-disable-next-line unicorn/no-null -- `recognize_games` reports an unpublished release as null.
				releaseId: null,
				releaseRevisionId: "revision-ico-us",
			}),
		);

		const release = await new Games(identity).getRelease(ICO_ID);

		expect(release?.releaseId).toBeUndefined();
		expect(release?.revisionId).toBe("revision-ico-us");
	});

	it("asks Activity once about a recognised disc", async () => {
		mocks.recognitions.mockImplementation(answerForIco(ICO_RELEASE));
		const games = new Games(identity);

		await games.getRelease(ICO_ID);
		await games.getRelease(ICO_ID);

		expect(mocks.recognitions).toHaveBeenCalledOnce();
	});

	it("trusts Activity's definitive answer that it does not know the disc", async () => {
		mocks.recognitions.mockImplementation(
			// oxlint-disable-next-line unicorn/no-null -- `recognize_games` reports "not recognised" as null fields.
			answerForIco({
				// oxlint-disable-next-line unicorn/no-null -- `recognize_games` reports unrecognised fields as null.
				gameId: null,
				// oxlint-disable-next-line unicorn/no-null -- `recognize_games` reports unrecognised fields as null.
				releaseId: null,
				// oxlint-disable-next-line unicorn/no-null -- `recognize_games` reports unrecognised fields as null.
				releaseRevisionId: null,
			}),
		);

		const games = new Games(identity);

		await expect(games.getRelease(ICO_ID)).resolves.toBeUndefined();
		await expect(games.getRelease(ICO_ID)).resolves.toBeUndefined();

		expect(mocks.recognitions).toHaveBeenCalledOnce();
	});

	it("asks again when Activity could not answer, picking up a later sign-in", async () => {
		const games = new Games(identity);

		await expect(games.getRelease(ICO_ID)).resolves.toBeUndefined();
		mocks.recognitions.mockImplementation(answerForIco(ICO_RELEASE));

		const release = await games.getRelease(ICO_ID);

		expect(release?.revisionId).toBe("revision-ico-us");
	});

	it("asks again after Activity failed", async () => {
		mocks.recognitions.mockRejectedValueOnce(new Error("catalog unreachable"));
		const games = new Games(identity);

		await expect(games.getRelease(ICO_ID)).resolves.toBeUndefined();
		mocks.recognitions.mockImplementation(answerForIco(ICO_RELEASE));

		const release = await games.getRelease(ICO_ID);

		expect(release?.revisionId).toBe("revision-ico-us");
	});

	it("does not ask Activity about a disc the backend cannot identify", async () => {
		await expect(
			new Games(identity).getRelease(FINAL_FANTASY_ID),
		).resolves.toBeUndefined();

		expect(mocks.recognitions).not.toHaveBeenCalled();
	});
});

describe("Games.sync", () => {
	const BATCH_LENGTHS = [RECOGNITION_BATCH_SIZE, RECOGNITION_BATCH_SIZE, 1];
	const LIBRARY_SIZE = sum(BATCH_LENGTHS);
	const appIds = Array.from({ length: LIBRARY_SIZE }, (_, index) => index + 1);

	/** Every shortcut launches an identifiable disc. */
	function library(): FakeIdentity {
		const large = new FakeIdentity();

		large.shortcuts = appIds;
		large.locate.mockImplementation(async (appId) => `/roms/${appId}.iso`);
		large.identify.mockImplementation(async (games) =>
			games.map((game) =>
				game.identifiedAs(
					DiscIdentity.fromResult({
						appId: game.appId,
						game_identity_md5: `${game.appId}`.padStart(ICO_MD5.length, "0"),
						platform: "ps2",
						rcheevos_id: 21,
						serial: `SLUS-${game.appId}`,
					}),
				),
			),
		);

		return large;
	}

	it("sends every identified game in batches of at most 256, reporting each, then serves releases without asking again", async () => {
		mocks.batches.mockImplementation(answerAll);
		const games = new Games(library());
		const onProgress = vi.fn<GameSyncListener>();
		const final = {
			answered: LIBRARY_SIZE,
			batch: BATCH_LENGTHS.length,
			batches: BATCH_LENGTHS.length,
			sent: LIBRARY_SIZE,
			total: LIBRARY_SIZE,
		};

		await expect(games.sync(onProgress)).resolves.toEqual(final);

		expect(
			onProgress.mock.calls.map(([{ answered, batch, sent }]) => ({
				answered,
				batch,
				sent,
			})),
		).toEqual([
			{ answered: 0, batch: 0, sent: 0 },
			{
				answered: RECOGNITION_BATCH_SIZE,
				batch: 1,
				sent: RECOGNITION_BATCH_SIZE,
			},
			{
				answered: RECOGNITION_BATCH_SIZE + RECOGNITION_BATCH_SIZE,
				batch: 2,
				sent: RECOGNITION_BATCH_SIZE + RECOGNITION_BATCH_SIZE,
			},
			{ answered: LIBRARY_SIZE, batch: 3, sent: LIBRARY_SIZE },
		]);

		expect(onProgress).toHaveBeenLastCalledWith(final);

		expect(mocks.batches.mock.calls.map(([batch]) => batch.length)).toEqual(
			BATCH_LENGTHS,
		);

		expect(
			mocks.batches.mock.calls.flatMap(([batch]) =>
				batch.map(({ appId }) => appId),
			),
		).toEqual(appIds);

		await expect(games.getRelease(LIBRARY_SIZE)).resolves.toMatchObject({
			revisionId: "revision-ico-us",
		});

		expect(mocks.recognitions).not.toHaveBeenCalled();
	});

	it("skips games without a disc identity and counts games Activity did not answer", async () => {
		mocks.batches.mockImplementation(answerForIco(ICO_RELEASE));

		await expect(new Games(identity).sync()).resolves.toMatchObject({
			answered: 1,
			total: 1,
		});

		mocks.batches.mockResolvedValue([]);

		await expect(new Games(identity).sync()).resolves.toMatchObject({
			answered: 0,
			total: 1,
		});

		expect(
			mocks.batches.mock.calls.map(([batch]) =>
				batch.map(({ appId }) => appId),
			),
		).toEqual([[ICO_ID], [ICO_ID]]);
	});

	it("rejects failed identification instead of reporting an empty library, and retries it next sync", async () => {
		identity.identify.mockRejectedValueOnce(new Error("identity unavailable"));
		mocks.batches.mockImplementation(answerAll);
		const games = new Games(identity);

		await expect(games.sync()).rejects.toBeInstanceOf(Error);

		await expect(games.sync()).resolves.toMatchObject({
			answered: 1,
			total: 1,
		});
	});

	it("keeps answers and progress from discovered games when another shortcut fails", async () => {
		const partial = library();

		partial.shortcuts = [1, 2];
		partial.locate.mockRejectedValueOnce(new Error("Steam details unavailable"));
		mocks.batches.mockImplementation(answerAll);
		const games = new Games(partial);
		const onProgress = vi.fn<GameSyncListener>();

		await expect(games.sync(onProgress)).rejects.toBeInstanceOf(Error);

		expect(onProgress).toHaveBeenLastCalledWith({
			answered: 1,
			batch: 1,
			batches: 1,
			sent: 1,
			total: 1,
		});

		await expect(games.getRelease(2)).resolves.toMatchObject({
			revisionId: "revision-ico-us",
		});

		expect(mocks.recognitions).not.toHaveBeenCalled();
	});

	it("finishes normally when every shortcut is unsupported", async () => {
		identity.shortcuts = [FINAL_FANTASY_ID, BROWSER_ID];

		await expect(new Games(identity).sync()).resolves.toEqual({
			answered: 0,
			batch: 0,
			batches: 0,
			sent: 0,
			total: 0,
		});
	});

	it("rejects when a batch fails, keeping the answers of earlier batches", async () => {
		mocks.batches
			.mockImplementationOnce(answerAll)
			.mockRejectedValueOnce(new Error("catalog unreachable"));

		const games = new Games(library());

		await expect(games.sync()).rejects.toThrow("catalog unreachable");

		expect(mocks.batches).toHaveBeenCalledTimes(2);

		await expect(games.getRelease(1)).resolves.toMatchObject({
			revisionId: "revision-ico-us",
		});

		expect(mocks.recognitions).not.toHaveBeenCalled();
	});

	it("shares one sync between overlapping requests, telling a late caller the latest progress first", async () => {
		const { promise, resolve } =
			Promise.withResolvers<GameRecognitionResult[]>();

		mocks.batches.mockReturnValueOnce(promise);
		const games = new Games(library());
		const first = games.sync();

		await vi.waitFor(() => {
			expect(mocks.batches).toHaveBeenCalledOnce();
		});

		const late = vi.fn<GameSyncListener>();
		const second = games.sync(late);

		expect(late).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ batch: 0, sent: 0, total: LIBRARY_SIZE }),
		);

		resolve([]);
		const [firstResult, secondResult] = await Promise.all([first, second]);

		expect(firstResult).toBe(secondResult);
		expect(late).toHaveBeenLastCalledWith(firstResult);
		expect(mocks.batches).toHaveBeenCalledTimes(BATCH_LENGTHS.length);
	});

	it("stops sending batches once the session ends", async () => {
		const { promise, resolve } =
			Promise.withResolvers<GameRecognitionResult[]>();

		mocks.batches.mockReturnValueOnce(promise);
		const games = new Games(library());
		const sync = games.sync();

		await vi.waitFor(() => {
			expect(mocks.batches).toHaveBeenCalledOnce();
		});

		games.unMount();
		resolve([]);

		await expect(sync).rejects.toMatchObject({ name: "AbortError" });
		expect(mocks.batches).toHaveBeenCalledOnce();
	});

	it("rejects when Steam's shortcut list is unavailable", async () => {
		identity.shortcuts = undefined;

		await expect(new Games(identity).sync()).rejects.toThrow(
			"shortcut list is unavailable",
		);

		expect(mocks.batches).not.toHaveBeenCalled();
	});
});
