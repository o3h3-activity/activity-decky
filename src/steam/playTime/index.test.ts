import type { DeviceAuthorizationStatus } from "@api/account";
import type { PendingPlaytime } from "@api/activity";
import type { GameRecognitionResult } from "@api/catalog";
import type { ApiFailure, ApiResult } from "@api/rpc/result";
import {
	type ConnectivityTest,
	EConnectivityTestResult,
	ENetFakeLocalSystemState,
} from "@decky/ui/dist/globals/steam-client/system/network";
import { observable } from "@legendapp/state";
import { Games } from "@steam/games";
import { DiscIdentity, Game, GameRelease } from "@steam/games/game";
import type { Identity } from "@steam/games/identity";
import { LifetimeScope } from "@steam/lifetimeScope";
import { accountStore } from "@stores/account";
import { playTimeSyncStore } from "@stores/playTimeSync";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayTime } from "./index";

const mocks = vi.hoisted(() => ({
	enqueue:
		vi.fn<
			(
				steamId: string,
				appId: number,
				startedAt: number,
				endedAt: number,
			) => Promise<boolean>
		>(),
	pending: vi.fn<(steamId: string) => Promise<PendingPlaytime[]>>(),
	recognitions: vi.fn<() => Promise<GameRecognitionResult[]>>(),
	record:
		vi.fn<
			(
				...args: [string, string, string, number, number, string, number]
			) => Promise<ApiResult>
		>(),
}));

vi.mock(
	import("@api/activity"),
	() =>
		({
			enqueuePlaytime: mocks.enqueue,
			getPendingPlaytime: mocks.pending,
			recordPlaytime: mocks.record,
		}) as never,
);

vi.mock(
	import("@api/catalog"),
	() => ({ recognizeGames: mocks.recognitions }) as never,
);

vi.mock(import("@api/discIdentity"), () => ({}) as never);

vi.mock(import("@api/settings"), () => ({}) as never);
vi.mock(
	import("@stores/account"),
	() =>
		({
			accountStore: observable({ authorization: { status: "signedIn" } }),
		}) as never,
);

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: { error: vi.fn<() => void>() },
		}) as never,
);

const STEAM_ID = "76561197960287930";
const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_MAX_DELAY_MS = 900_000;
const HTTP_FORBIDDEN = 403;
const HTTP_UNPROCESSABLE_CONTENT = 422;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVICE_UNAVAILABLE = 503;
const unreachable: ApiFailure = { error: "unreachable", ok: false, status: 0 };
const NEXT_STARTED_AT = 3000;
const NEXT_ENDED_AT = 5000;
const catalogAnswer = {
	gameId: "game",
	gameIdentityMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	releaseId: "release",
	releaseRevisionId: "version",
};
const release = GameRelease.fromAnswer(catalogAnswer);
const interval: PendingPlaytime = { appId: 42, startedAt: 1000, endedAt: 2000 };
const disc = DiscIdentity.fromResult({
	appId: interval.appId,
	game_identity_md5: catalogAnswer.gameIdentityMd5,
	platform: "ps2",
	rcheevos_id: 21,
	serial: "SCUS-97113",
});
const supportedGame = Game.launching(interval.appId, "/game.iso").identifiedAs(disc);
const identity = {
	identify: vi.fn<Identity["identify"]>(),
	locate: vi.fn<Identity["locate"]>(),
	shortcutAppIds: () => [interval.appId],
};
let queue: PendingPlaytime[];
let scope: LifetimeScope;
let connectivity: ((test: ConnectivityTest) => void) | undefined;
let networkStore: {
	connectivityTestState: ConnectivityTest;
	hasSteamConnection: boolean;
};

function probe(
	eConnectivityTestResult: EConnectivityTestResult,
	bChecking = false,
): ConnectivityTest {
	return {
		bChecking,
		eConnectivityTestResult,
		eFakeState: ENetFakeLocalSystemState.Normal,
	};
}

/** Mirrors Steam: its store records the probe result and registered listeners hear it. */
function reportConnectivity(
	eConnectivityTestResult: EConnectivityTestResult,
	bChecking = false,
): void {
	networkStore.connectivityTestState = probe(
		eConnectivityTestResult,
		bChecking,
	);

	connectivity?.(networkStore.connectivityTestState);
}

function registerForConnectivityTestChanges(
	listener: (test: ConnectivityTest) => void,
): Unregisterable {
	connectivity = listener;

	return {
		unregister: () => {
			connectivity = undefined;
		},
	};
}

function reconnect(): void {
	reportConnectivity(EConnectivityTestResult.Failed);
	reportConnectivity(EConnectivityTestResult.Connected);
}

function authorize(status: DeviceAuthorizationStatus): void {
	accountStore.authorization.status.set(status);
}

function commit(
	startedAt = interval.startedAt,
	endedAt = interval.endedAt,
): void {
	window.dispatchEvent(
		new CustomEvent("playtime:interval-committed:v1", {
			detail: { endedAt, game: { id: "42", name: "Game" }, startedAt },
		}),
	);
}

function mount(
	getRelease = vi.fn<Games["getRelease"]>().mockResolvedValue(release),
	get = vi.fn<Games["get"]>().mockResolvedValue(supportedGame),
): void {
	scope
		.track(
			new PlayTime(STEAM_ID, { get, getRelease } as unknown as Games),
		)
		.mount();
}

function mountGames(): void {
	const games = scope.track(new Games(identity));

	scope.track(new PlayTime(STEAM_ID, games)).mount();
}

beforeEach(() => {
	vi.stubGlobal("window", new EventTarget());
	queue = [];
	mocks.recognitions.mockReset();
	mocks.recognitions.mockResolvedValue([catalogAnswer]);
	identity.locate.mockReset();
	identity.locate.mockResolvedValue("/game.iso");
	identity.identify.mockReset();
	identity.identify.mockImplementation(async (games) =>
		games.map((game) => game.identifiedAs(disc)),
	);

	mocks.enqueue.mockReset();
	mocks.enqueue.mockImplementation(
		async (_steamId, appId, startedAt, endedAt) => {
			queue.push({ appId, startedAt, endedAt });

			return true;
		},
	);

	mocks.pending.mockReset();
	mocks.pending.mockImplementation(async () => [...queue]);
	mocks.record.mockReset();
	mocks.record.mockImplementation(async (...args) => {
		const start = args[3];
		const end = args[4];

		queue = queue.filter(
			(item) => item.startedAt !== start || item.endedAt !== end,
		);

		return { data: undefined, ok: true };
	});

	authorize("signedIn");
	playTimeSyncStore.isEnabled.set(true);
	scope = new LifetimeScope("PlayTime test");
	connectivity = undefined;
	networkStore = {
		connectivityTestState: probe(EConnectivityTestResult.Connected),
		hasSteamConnection: false,
	};

	window.SystemNetworkStore = networkStore;
	vi.stubGlobal("SteamClient", {
		System: {
			Network: {
				RegisterForConnectivityTestChanges: registerForConnectivityTestChanges,
			},
		},
	});
});

afterEach(() => {
	scope.unMount();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("PlayTime offline delivery", () => {
	it.each(["no ROM", "unidentified ROM", "Steam failure", "identification failure"])(
		"does not persist or retry an interval without confirmed local support: %s",
		async (outcome) => {
			vi.useFakeTimers();

			if (outcome === "no ROM") {
				identity.locate.mockResolvedValue(undefined);
			} else if (outcome === "unidentified ROM") {
				identity.identify.mockImplementation(async (games) => [...games]);
			} else if (outcome === "Steam failure") {
				identity.locate.mockRejectedValueOnce(new Error("Steam unavailable"));
			} else {
				identity.identify.mockRejectedValueOnce(new Error("Backend unavailable"));
			}

			mountGames();
			commit();
			await vi.advanceTimersByTimeAsync(0);
			expect(mocks.enqueue).not.toHaveBeenCalled();
			expect(mocks.record).not.toHaveBeenCalled();
			expect(queue).toEqual([]);

			const passes = mocks.pending.mock.calls.length;

			await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS * 2);
			expect(mocks.pending).toHaveBeenCalledTimes(passes);
		},
	);

	it("confirms local support before persisting, without waiting for catalog recognition", async () => {
		vi.useFakeTimers();
		const lookup = Promise.withResolvers<string | undefined>();
		const recognition = Promise.withResolvers<GameRecognitionResult[]>();

		identity.locate.mockReturnValueOnce(lookup.promise);
		mocks.recognitions.mockReturnValueOnce(recognition.promise);
		mountGames();
		commit();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.enqueue).not.toHaveBeenCalled();

		lookup.resolve("/game.iso");
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([interval]);
		expect(mocks.record).not.toHaveBeenCalled();

		recognition.resolve([catalogAnswer]);
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([]);
	});

	it("retains a locally supported interval after a catalog failure and retries it", async () => {
		vi.useFakeTimers();
		mocks.recognitions.mockRejectedValueOnce(new Error("Catalog unavailable"));
		mountGames();
		commit();
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([interval]);
		expect(mocks.record).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS);
		expect(queue).toEqual([]);
		expect(mocks.record).toHaveBeenCalledOnce();
	});

	it("retries an interval when connectivity returns after recognition failed", async () => {
		const getRelease = vi
			.fn<Games["getRelease"]>()
			.mockResolvedValueOnce(undefined)
			.mockResolvedValue(release);

		mount(getRelease);
		commit();
		await vi.waitFor(() => {
			expect(getRelease).toHaveBeenCalledOnce();
		});

		expect(queue).toEqual([interval]);
		reconnect();
		await vi.waitFor(() => {
			expect(queue).toEqual([]);
		});

		expect(mocks.record).toHaveBeenCalledOnce();
	});

	it("persists before recognition and recovers on remount without another commit", async () => {
		const recognition = Promise.withResolvers<GameRelease | undefined>();

		mount(vi.fn<Games["getRelease"]>(() => recognition.promise));
		commit();
		await vi.waitFor(() => {
			expect(queue).toEqual([interval]);
		});

		scope.unMount();
		recognition.resolve(release);
		await recognition.promise;
		await Promise.resolve();
		expect(mocks.record).not.toHaveBeenCalled();

		scope = new LifetimeScope("Restarted PlayTime");
		mount();
		await vi.waitFor(() => {
			expect(queue).toEqual([]);
		});
	});

	it("doubles the retry delay per failed pass and stops polling once the queue is empty", async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(1);
		mocks.record
			.mockResolvedValueOnce(unreachable)
			.mockResolvedValueOnce(unreachable);

		mount();
		commit();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.record).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(RETRY_BASE_DELAY_MS);
		expect(mocks.record).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(RETRY_BASE_DELAY_MS * 2 - 1);
		expect(mocks.record).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(queue).toEqual([]);

		const passes = mocks.pending.mock.calls.length;

		await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS * 2);
		expect(mocks.pending).toHaveBeenCalledTimes(passes);
	});

	it("retries at once and restarts the retry delay when Steam regains connectivity", async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(1);
		mocks.record
			.mockResolvedValueOnce(unreachable)
			.mockResolvedValueOnce(unreachable)
			.mockResolvedValueOnce(unreachable);

		mount();
		commit();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.record).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(RETRY_BASE_DELAY_MS);
		expect(mocks.record).toHaveBeenCalledTimes(2);
		reconnect();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.record).toHaveBeenCalledTimes(2 + 1);
		await vi.advanceTimersByTimeAsync(RETRY_BASE_DELAY_MS);
		expect(queue).toEqual([]);
	});

	it("treats only a transition to connected as a reconnect", async () => {
		mount();
		reconnect();
		await vi.waitFor(() => {
			expect(mocks.pending).toHaveBeenCalledTimes(2);
		});

		reportConnectivity(EConnectivityTestResult.Connected);
		reportConnectivity(EConnectivityTestResult.Failed, true);
		reportConnectivity(EConnectivityTestResult.Unknown);
		reportConnectivity(EConnectivityTestResult.Connected);
		await Promise.resolve();
		expect(mocks.pending).toHaveBeenCalledTimes(2);

		reconnect();
		await vi.waitFor(() => {
			expect(mocks.pending).toHaveBeenCalledTimes(2 + 1);
		});
	});

	it.each([
		{
			state: "the probe failed",
			result: EConnectivityTestResult.Failed,
			steam: false,
			uploads: false,
		},
		{
			state: "behind a captive portal",
			result: EConnectivityTestResult.CaptivePortal,
			steam: false,
			uploads: false,
		},
		{
			state: "Wi-Fi is off",
			result: EConnectivityTestResult.WifiDisabled,
			steam: false,
			uploads: false,
		},
		{
			state: "connected to Steam despite a failed probe",
			result: EConnectivityTestResult.Failed,
			steam: true,
			uploads: true,
		},
		{
			state: "the probe has not run",
			result: EConnectivityTestResult.Unknown,
			steam: false,
			uploads: true,
		},
	])(
		"persists but uploads only while Steam reports Internet: $state",
		async ({ result, steam, uploads }) => {
			vi.useFakeTimers();
			networkStore.connectivityTestState = probe(result);
			networkStore.hasSteamConnection = steam;

			mount();
			commit();
			await vi.advanceTimersByTimeAsync(0);
			expect(mocks.enqueue).toHaveBeenCalledOnce();
			expect(queue).toEqual(uploads ? [] : [interval]);
		},
	);

	it("holds intervals while offline and sends them when Steam's probe connects", async () => {
		vi.useFakeTimers();
		reportConnectivity(EConnectivityTestResult.NoLAN);
		mount();
		commit();
		await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS);
		expect(mocks.record).not.toHaveBeenCalled();

		reportConnectivity(EConnectivityTestResult.Connected);
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([]);
	});

	it("resumes on a pending retry once Steam reconnects without a new probe result", async () => {
		vi.useFakeTimers();
		reportConnectivity(EConnectivityTestResult.Failed);
		mount();
		commit();
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([interval]);

		networkStore.hasSteamConnection = true;
		await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS);
		expect(queue).toEqual([]);
	});

	it("falls back to the browser online event without Steam's connectivity probe", async () => {
		vi.stubGlobal("SteamClient", undefined);
		mocks.record.mockResolvedValueOnce(unreachable);

		mount();
		commit();
		await vi.waitFor(() => {
			expect(mocks.record).toHaveBeenCalledOnce();
		});

		window.dispatchEvent(new Event("online"));
		await vi.waitFor(() => {
			expect(queue).toEqual([]);
		});
	});

	it.each([
		[HTTP_SERVICE_UNAVAILABLE, 1],
		[HTTP_TOO_MANY_REQUESTS, 1],
		[HTTP_FORBIDDEN, 2],
	])(
		"after HTTP %i on the first interval, attempts %i upload(s) in that pass",
		async (status, uploads) => {
			vi.useFakeTimers();
			queue = [
				interval,
				{ ...interval, startedAt: NEXT_STARTED_AT, endedAt: NEXT_ENDED_AT },
			];

			mocks.record.mockResolvedValueOnce({
				error: "httpError",
				ok: false,
				status,
			});

			mount();
			await vi.advanceTimersByTimeAsync(0);
			expect(mocks.record).toHaveBeenCalledTimes(uploads);
		},
	);

	it("stops polling once the backend discards a refused interval", async () => {
		vi.useFakeTimers();
		mocks.record.mockImplementationOnce(async (...args) => {
			queue = queue.filter((item) => item.startedAt !== args[3]);

			return {
				error: "refused",
				ok: false,
				status: HTTP_UNPROCESSABLE_CONTENT,
			};
		});

		mount();
		commit();
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([]);

		const passes = mocks.pending.mock.calls.length;

		await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS * 2);
		expect(mocks.pending).toHaveBeenCalledTimes(passes);
	});

	it.each<ApiFailure>([
		{ error: "invalidRequest", ok: false, status: 0 },
		{ error: "httpError", ok: false, status: HTTP_FORBIDDEN },
	])(
		"keeps retrying an interval the backend kept after $error $status",
		async (failure) => {
			vi.useFakeTimers();
			mocks.record.mockResolvedValueOnce(failure);

			mount();
			commit();
			await vi.advanceTimersByTimeAsync(0);
			expect(queue).toEqual([interval]);

			await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS);
			expect(queue).toEqual([]);
		},
	);

	it("holds intervals for another Activity account until the next sign-in", async () => {
		vi.useFakeTimers();
		queue = [
			interval,
			{ ...interval, startedAt: NEXT_STARTED_AT, endedAt: NEXT_ENDED_AT },
		];

		mocks.record.mockResolvedValueOnce({
			error: "accountMismatch",
			ok: false,
			status: 0,
		});

		mount();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.record).toHaveBeenCalledOnce();
		await vi.advanceTimersByTimeAsync(RETRY_MAX_DELAY_MS * 2);
		expect(mocks.record).toHaveBeenCalledOnce();

		authorize("signedOut");
		authorize("signedIn");
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([]);
	});

	it("serializes reconnect attempts and includes commits arriving during an upload", async () => {
		const upload = Promise.withResolvers<ApiResult>();

		mocks.record.mockImplementationOnce(async () => upload.promise);
		mount();
		commit();
		await vi.waitFor(() => {
			expect(mocks.record).toHaveBeenCalledOnce();
		});

		reconnect();
		reconnect();
		commit(NEXT_STARTED_AT, NEXT_ENDED_AT);
		await vi.waitFor(() => {
			expect(queue).toHaveLength(2);
		});

		expect(mocks.record).toHaveBeenCalledOnce();
		queue = queue.filter((item) => item.startedAt !== interval.startedAt);
		upload.resolve({ data: undefined, ok: true });
		await vi.waitFor(() => {
			expect(queue).toEqual([]);
		});

		expect(mocks.record).toHaveBeenCalledTimes(2);
	});

	it("replays the pinned release when a shortcut can no longer be recognized", async () => {
		queue = [
			{
				...interval,
				gameId: "old-game",
				releaseId: "old-release",
				releaseRevisionId: "old-version",
			},
		];

		const getRelease = vi
			.fn<Games["getRelease"]>()
			.mockResolvedValue(undefined);

		mount(getRelease, vi.fn<Games["get"]>().mockResolvedValue(undefined));
		await vi.waitFor(() => {
			expect(queue).toEqual([]);
		});

		expect(getRelease).not.toHaveBeenCalled();
		expect(mocks.record).toHaveBeenCalledWith(
			"old-game",
			"old-release",
			"old-version",
			interval.startedAt,
			interval.endedAt,
			STEAM_ID,
			interval.appId,
		);
	});

	it("does not begin recognition when persisting the interval fails", async () => {
		mocks.enqueue.mockRejectedValueOnce(new Error("Disk unavailable"));
		const getRelease = vi.fn<Games["getRelease"]>();

		mount(getRelease);
		commit();
		await vi.waitFor(() => {
			expect(mocks.enqueue).toHaveBeenCalled();
		});

		expect(getRelease).not.toHaveBeenCalled();
		expect(mocks.record).not.toHaveBeenCalled();
	});
});

describe("PlayTime sharing and session lifetime", () => {
	it.each([false, undefined])(
		"does not collect or send while sharing is %s",
		async (enabled) => {
			playTimeSyncStore.isEnabled.set(enabled);
			queue = [interval];
			mount();
			commit();
			reconnect();
			await Promise.resolve();
			expect(mocks.enqueue).not.toHaveBeenCalled();
			expect(mocks.record).not.toHaveBeenCalled();
			expect(queue).toEqual([interval]);
		},
	);

	it("resumes the queue when sharing is enabled", async () => {
		queue = [interval];
		playTimeSyncStore.isEnabled.set(false);
		mount();
		playTimeSyncStore.isEnabled.set(true);
		await vi.waitFor(() => {
			expect(queue).toEqual([]);
		});
	});

	it("pauses while signed out and resumes on sign-in", async () => {
		authorize("signedOut");
		queue = [interval];
		mount();
		commit(NEXT_STARTED_AT, NEXT_ENDED_AT);
		reconnect();
		await Promise.resolve();
		expect(mocks.enqueue).not.toHaveBeenCalled();
		expect(mocks.record).not.toHaveBeenCalled();
		authorize("signedIn");
		await vi.waitFor(() => {
			expect(queue).toEqual([]);
		});
	});

	it.each(["disabled", "signedOut", "unmounted"])(
		"does not persist an interval if %s during the local support check",
		async (transition) => {
			vi.useFakeTimers();
			const pending = Promise.withResolvers<Game | undefined>();
			const get = vi.fn<Games["get"]>(() => pending.promise);

			mount(undefined, get);
			commit();
			await vi.advanceTimersByTimeAsync(0);
			expect(get).toHaveBeenCalledOnce();

			if (transition === "disabled") {
				playTimeSyncStore.isEnabled.set(false);
			} else if (transition === "signedOut") {
				authorize("signedOut");
			} else {
				scope.unMount();
			}

			pending.resolve(supportedGame);
			await vi.advanceTimersByTimeAsync(0);
			expect(mocks.enqueue).not.toHaveBeenCalled();
			expect(queue).toEqual([]);
		},
	);

	it.each(["disabled", "signedOut", "unmounted"])(
		"retains pending intervals if %s during recognition",
		async (transition) => {
			const pending = Promise.withResolvers<GameRelease | undefined>();
			const getRelease = vi.fn<Games["getRelease"]>(() => pending.promise);

			mount(getRelease);
			commit();
			await vi.waitFor(() => {
				expect(getRelease).toHaveBeenCalled();
			});

			if (transition === "disabled") {
				playTimeSyncStore.isEnabled.set(false);
			} else if (transition === "signedOut") {
				authorize("signedOut");
			} else {
				scope.unMount();
			}

			pending.resolve(release);
			await pending.promise;
			await Promise.resolve();
			expect(mocks.record).not.toHaveBeenCalled();
			expect(queue).toEqual([interval]);
		},
	);

	it("stops consuming intervals and reconnects after unmount", async () => {
		mount();
		scope.unMount();
		commit();
		reconnect();
		await Promise.resolve();
		expect(mocks.enqueue).not.toHaveBeenCalled();
		expect(mocks.record).not.toHaveBeenCalled();
	});

	it("retains unpublished releases until a new session can recognize their publication", async () => {
		vi.useFakeTimers();
		mocks.recognitions.mockResolvedValue([
			// oxlint-disable-next-line unicorn/no-null -- The catalog reports unpublished releases as null.
			{ ...catalogAnswer, releaseId: null },
		]);

		mountGames();
		commit();
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([interval]);
		expect(mocks.record).not.toHaveBeenCalled();

		mocks.recognitions.mockResolvedValue([catalogAnswer]);
		reconnect();
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([interval]);

		scope.unMount();
		scope = new LifetimeScope("Restarted PlayTime");
		mountGames();
		await vi.advanceTimersByTimeAsync(0);
		expect(queue).toEqual([]);
	});
});
