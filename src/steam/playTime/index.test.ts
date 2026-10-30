import type { ActivityUser, DeviceAuthorizationState } from "@api/account";
import type { PendingPlaytime } from "@api/activity";
import type { ApiFailure, ApiResult } from "@api/rpc/result";
import {
	type ConnectivityTest,
	EConnectivityTestResult,
	ENetFakeLocalSystemState,
} from "@decky/ui/dist/globals/steam-client/system/network";
import { observable } from "@legendapp/state";
import type { Games } from "@steam/games";
import type { Game, GameRelease } from "@steam/games/game";
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
	record:
		vi.fn<
			(
				...args: [string, string, string, number, number, string, number]
			) => Promise<ApiResult>
		>(),
	steamId: vi.fn<() => Nullable<string>>(),
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
	import("@steam/proxy/app"),
	() => ({ App: { getCurrentUserIdAsU64: mocks.steamId } }) as never,
);

vi.mock(import("@api/settings"), () => ({}) as never);
vi.mock(
	import("@stores/account"),
	() =>
		({
			accountStore: observable({
				authorization: undefined,
				profile: undefined,
			}),
		}) as never,
);

vi.mock(
	import("@utils/logger"),
	() => ({ default: { error: vi.fn<() => void>() } }) as never,
);

const STEAM_ID = "76561197960287930";
const RETRY_BASE_DELAY_MS = 30_000;
const RETRY_OBSERVATION_MS = 240_000;
const UNKNOWN_DELIVERY: ApiFailure = {
	error: "deliveryUnknown",
	ok: false,
	status: 503,
};
const UNREACHABLE: ApiFailure = { error: "unreachable", ok: false, status: 0 };
const release = {
	gameId: "game",
	releaseId: "release",
	revisionId: "revision",
} as GameRelease;
const discGame = { disc: {} } as Game;
const interval: PendingPlaytime = { appId: 42, endedAt: 2000, startedAt: 1000 };
const laterInterval: PendingPlaytime = {
	appId: 42,
	endedAt: 5000,
	startedAt: 3000,
};
let entries: PendingPlaytime[];
let playTime: PlayTime | undefined;
let connectivity: ((test: ConnectivityTest) => void) | undefined;
let networkStore: {
	connectivityTestState: ConnectivityTest;
	hasSteamConnection: boolean;
};

function probe(result: EConnectivityTestResult): ConnectivityTest {
	return {
		bChecking: false,
		eConnectivityTestResult: result,
		eFakeState: ENetFakeLocalSystemState.Normal,
	};
}

function reportConnectivity(result: EConnectivityTestResult): void {
	networkStore.connectivityTestState = probe(result);
	connectivity?.(networkStore.connectivityTestState);
}

function authorization(
	status: DeviceAuthorizationState["status"] = "signedIn",
	tokenExpiresAt = "",
): DeviceAuthorizationState {
	return {
		accessTokensUrl: "",
		codeExpiresAt: 0,
		message: "",
		retroAchievementsCredentialSync: false,
		retroAchievementsLinked: false,
		status,
		tokenExpiresAt,
		userCode: "",
		verificationUri: "",
		verificationUriComplete: "",
	};
}

function profile(steamId: ActivityUser["steamId"]): ActivityUser {
	return {
		avatarUrl: "https://example.test/avatar.png",
		nickname: "Player",
		steamId,
	};
}

function authorize(tokenExpiresAt = "2030-01-01T00:00:00Z"): void {
	accountStore.authorization.set(authorization("signedIn", tokenExpiresAt));
}

function commit(detail: unknown): void {
	window.dispatchEvent(
		new CustomEvent("playtime:interval-committed:v1", { detail }),
	);
}

function supportedCommit(
	startedAt = interval.startedAt,
	endedAt = interval.endedAt,
): void {
	commit({ endedAt, game: { id: String(interval.appId) }, startedAt });
}

function removeUploaded(startedAt: number, endedAt: number): void {
	entries = entries.filter(
		(entry) => entry.startedAt !== startedAt || entry.endedAt !== endedAt,
	);
}

function mount(
	get = vi.fn<Games["get"]>().mockResolvedValue(discGame),
	getRelease = vi.fn<Games["getRelease"]>().mockResolvedValue(release),
): { get: Games["get"]; getRelease: Games["getRelease"] } {
	playTime = new PlayTime({ get, getRelease } as unknown as Games);
	playTime.mount();

	return { get, getRelease };
}

function registerConnectivity(listener: (test: ConnectivityTest) => void): {
	unregister: () => void;
} {
	connectivity = listener;

	return {
		unregister: () => {
			connectivity = undefined;
		},
	};
}

beforeEach(() => {
	vi.stubGlobal("window", new EventTarget());
	entries = [];
	playTime = undefined;
	connectivity = undefined;
	networkStore = {
		connectivityTestState: probe(EConnectivityTestResult.Connected),
		hasSteamConnection: false,
	};

	window.SystemNetworkStore = networkStore;
	vi.stubGlobal("SteamClient", {
		System: {
			Network: {
				RegisterForConnectivityTestChanges: registerConnectivity,
			},
		},
	});

	accountStore.authorization.set(authorization());
	accountStore.profile.set(undefined);
	playTimeSyncStore.isEnabled.set(true);
	mocks.steamId.mockReset();
	mocks.steamId.mockReturnValue(STEAM_ID);
	mocks.enqueue.mockReset();
	mocks.enqueue.mockImplementation(
		async (_steamId, appId, startedAt, endedAt) => {
			entries.push({ appId, endedAt, startedAt });

			return true;
		},
	);

	mocks.pending.mockReset();
	mocks.pending.mockImplementation(async () => [...entries]);
	mocks.record.mockReset();
	mocks.record.mockImplementation(async (...args) => {
		removeUploaded(args[3], args[4]);

		return { data: undefined, ok: true };
	});
});

afterEach(() => {
	playTime?.unMount();
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("PlayTime collection", () => {
	it("rejects malformed, unsafe, and backwards events before a game lookup", async () => {
		const { get } = mount();

		for (const detail of [
			undefined,
			{},
			{ endedAt: 2, game: { id: 0 }, startedAt: 1 },
			{ endedAt: 2, game: { id: "42.5" }, startedAt: 1 },
			{
				endedAt: Number.MAX_SAFE_INTEGER + 1,
				game: { id: "42" },
				startedAt: 1,
			},
			{ endedAt: 2, game: { id: "42" }, startedAt: Number.NaN },
			{ endedAt: 2.5, game: { id: "42" }, startedAt: 1 },
			{ endedAt: "2", game: { id: "42" }, startedAt: 1 },
			{ endedAt: 1, game: { id: "42" }, startedAt: 2 },
		]) {
			commit(detail);
		}

		await Promise.resolve();
		expect(get).not.toHaveBeenCalled();
		expect(mocks.enqueue).not.toHaveBeenCalled();
	});

	it("stays inert without a current Steam user", async () => {
		mocks.steamId.mockReturnValue(undefined);
		const { get } = mount();

		supportedCommit();
		await Promise.resolve();
		expect(get).not.toHaveBeenCalled();
		expect(mocks.pending).not.toHaveBeenCalled();
		expect(mocks.enqueue).not.toHaveBeenCalled();
	});

	it("queues an identified disc before catalog resolution and replays it after restart", async () => {
		const resolution = Promise.withResolvers<GameRelease | undefined>();
		const { getRelease } = mount(
			undefined,
			vi.fn<Games["getRelease"]>().mockReturnValue(resolution.promise),
		);

		supportedCommit();
		await vi.waitFor(() => {
			expect(mocks.enqueue).toHaveBeenCalledWith(
				STEAM_ID,
				interval.appId,
				interval.startedAt,
				interval.endedAt,
			);

			expect(getRelease).toHaveBeenCalledWith(interval.appId);
		});

		expect(mocks.record).not.toHaveBeenCalled();

		playTime?.unMount();
		resolution.resolve(release);
		await resolution.promise;
		await Promise.resolve();
		expect(mocks.record).not.toHaveBeenCalled();

		mount();
		await vi.waitFor(() => expect(entries).toEqual([]));
	});

	it("does not persist unsupported discs or a stale lookup after sharing flips off and on", async () => {
		const lookup = Promise.withResolvers<Game | undefined>();
		const { get } = mount(
			vi.fn<Games["get"]>().mockReturnValue(lookup.promise),
		);

		supportedCommit();
		await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
		playTimeSyncStore.isEnabled.set(false);
		playTimeSyncStore.isEnabled.set(true);
		lookup.resolve(discGame);
		await Promise.resolve();
		expect(mocks.enqueue).not.toHaveBeenCalled();

		playTime?.unMount();
		mount(vi.fn<Games["get"]>().mockResolvedValue({} as Game));
		supportedCommit();
		await Promise.resolve();
		expect(mocks.enqueue).not.toHaveBeenCalled();
	});

	it("collects and uploads a lookup when a matching profile loads", async () => {
		const lookup = Promise.withResolvers<Game | undefined>();
		const { get } = mount(
			vi.fn<Games["get"]>().mockReturnValue(lookup.promise),
		);

		supportedCommit();
		await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
		accountStore.profile.set(profile(STEAM_ID));
		lookup.resolve(discGame);

		await vi.waitFor(() =>
			expect(mocks.record).toHaveBeenCalledWith(
				"game",
				"release",
				"revision",
				interval.startedAt,
				interval.endedAt,
				STEAM_ID,
				interval.appId,
			),
		);
	});

	it("collects a lookup after signed-in authorization metadata changes", async () => {
		const lookup = Promise.withResolvers<Game | undefined>();
		const { get } = mount(
			vi.fn<Games["get"]>().mockReturnValue(lookup.promise),
		);

		supportedCommit();
		await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
		authorize("2031-01-01T00:00:00Z");
		lookup.resolve(discGame);

		await vi.waitFor(() =>
			expect(mocks.record).toHaveBeenCalledWith(
				"game",
				"release",
				"revision",
				interval.startedAt,
				interval.endedAt,
				STEAM_ID,
				interval.appId,
			),
		);
	});

	it("does not persist a stale lookup after signing out and back in", async () => {
		const lookup = Promise.withResolvers<Game | undefined>();
		const { get } = mount(
			vi.fn<Games["get"]>().mockReturnValue(lookup.promise),
		);

		supportedCommit();
		await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
		accountStore.authorization.set(authorization("signedOut"));
		authorize();
		lookup.resolve(discGame);
		await Promise.resolve();

		expect(mocks.enqueue).not.toHaveBeenCalled();
	});

	it("does not persist a stale lookup after a mismatched profile becomes matching", async () => {
		const lookup = Promise.withResolvers<Game | undefined>();
		const { get } = mount(
			vi.fn<Games["get"]>().mockReturnValue(lookup.promise),
		);

		supportedCommit();
		await vi.waitFor(() => expect(get).toHaveBeenCalledOnce());
		accountStore.profile.set(profile("other"));
		accountStore.profile.set(profile(STEAM_ID));
		lookup.resolve(discGame);
		await Promise.resolve();

		expect(mocks.enqueue).not.toHaveBeenCalled();
	});

	it("stops collection once a loaded profile belongs to another Steam account", async () => {
		accountStore.profile.set(profile("other"));
		const { get } = mount();

		supportedCommit();
		await Promise.resolve();
		expect(get).not.toHaveBeenCalled();
		expect(mocks.enqueue).not.toHaveBeenCalled();
	});

	it.each(["disabled", "signedOut"] as const)(
		"does not collect or upload while %s",
		async (state) => {
			entries = [interval];

			if (state === "disabled") {
				playTimeSyncStore.isEnabled.set(false);
			} else {
				accountStore.authorization.set(authorization("signedOut"));
			}

			const { get } = mount();

			supportedCommit();
			await Promise.resolve();
			expect(get).not.toHaveBeenCalled();
			expect(mocks.enqueue).not.toHaveBeenCalled();
			expect(mocks.record).not.toHaveBeenCalled();
			expect(entries).toEqual([interval]);
		},
	);

	it("does not upload an interval whose durable enqueue fails", async () => {
		mocks.enqueue.mockRejectedValue(new Error("disk full"));
		mount();
		supportedCommit();

		await vi.waitFor(() => expect(mocks.enqueue).toHaveBeenCalledOnce());
		expect(mocks.record).not.toHaveBeenCalled();
		expect(entries).toEqual([]);
	});
});

describe("PlayTime sync", () => {
	it("holds offline entries and wakes immediately when Steam reconnects", async () => {
		reportConnectivity(EConnectivityTestResult.NoLAN);
		mount();
		supportedCommit();
		await vi.waitFor(() => expect(mocks.enqueue).toHaveBeenCalledOnce());
		expect(mocks.record).not.toHaveBeenCalled();

		reportConnectivity(EConnectivityTestResult.Connected);
		await vi.waitFor(() => expect(entries).toEqual([]));
	});

	it("retries a failed pass with bounded backoff", async () => {
		vi.useFakeTimers();
		vi.spyOn(Math, "random").mockReturnValue(1);
		mocks.record.mockResolvedValueOnce(UNREACHABLE);
		mount();
		supportedCommit();
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.record).toHaveBeenCalledOnce();

		await vi.advanceTimersByTimeAsync(RETRY_BASE_DELAY_MS);
		expect(entries).toEqual([]);
		expect(mocks.record).toHaveBeenCalledTimes(2);
	});

	it("continues after one recognition failure and retries only that entry", async () => {
		vi.useFakeTimers();
		entries = [interval, laterInterval];
		const getRelease = vi
			.fn<Games["getRelease"]>()
			.mockRejectedValueOnce(new Error("catalog unavailable"))
			.mockResolvedValue(release);

		mount(undefined, getRelease);
		await vi.advanceTimersByTimeAsync(0);
		expect(mocks.record).toHaveBeenCalledOnce();
		expect(entries).toEqual([interval]);

		await vi.advanceTimersByTimeAsync(RETRY_BASE_DELAY_MS);
		expect(entries).toEqual([]);
	});

	it("does not retry a delivery the backend has held as unknown", async () => {
		vi.useFakeTimers();
		entries = [interval, laterInterval];
		mocks.record
			.mockImplementationOnce(async (...args) => {
				removeUploaded(args[3], args[4]);

				return UNKNOWN_DELIVERY;
			})
			.mockImplementation(async (...args) => {
				removeUploaded(args[3], args[4]);

				return { data: undefined, ok: true };
			});

		mount();
		await vi.advanceTimersByTimeAsync(0);
		expect(entries).toEqual([]);
		expect(mocks.record).toHaveBeenCalledTimes(2);

		await vi.advanceTimersByTimeAsync(RETRY_OBSERVATION_MS);
		expect(mocks.record).toHaveBeenCalledTimes(2);
	});

	it("retries an account-mismatch hold after signed-in authorization metadata changes", async () => {
		entries = [interval];
		mocks.record.mockResolvedValueOnce({
			error: "accountMismatch",
			ok: false,
			status: 0,
		});

		mount();
		await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
		expect(entries).toEqual([interval]);

		authorize("2032-01-01T00:00:00Z");
		await vi.waitFor(() => expect(entries).toEqual([]));
		expect(mocks.record).toHaveBeenCalledTimes(2);
	});

	it("serializes uploads and drains a commit received during an upload", async () => {
		const firstUpload = Promise.withResolvers<ApiResult>();

		mocks.record.mockImplementationOnce(() => firstUpload.promise);
		mount();
		supportedCommit();
		await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());

		supportedCommit(laterInterval.startedAt, laterInterval.endedAt);
		await vi.waitFor(() => expect(entries).toHaveLength(2));
		expect(mocks.record).toHaveBeenCalledOnce();
		removeUploaded(interval.startedAt, interval.endedAt);
		firstUpload.resolve({ data: undefined, ok: true });

		await vi.waitFor(() => expect(entries).toEqual([]));
		expect(mocks.record).toHaveBeenCalledTimes(2);
	});

	it("uses the original release binding even when recognition has changed", async () => {
		entries = [
			{
				...interval,
				gameId: "original-game",
				releaseId: "original-release",
				releaseRevisionId: "original-revision",
			},
		];

		const { getRelease } = mount();

		await vi.waitFor(() => expect(entries).toEqual([]));
		expect(mocks.record).toHaveBeenCalledWith(
			"original-game",
			"original-release",
			"original-revision",
			interval.startedAt,
			interval.endedAt,
			STEAM_ID,
			interval.appId,
		);

		expect(getRelease).not.toHaveBeenCalled();
	});

	it.each(["unmount", "signedOut", "disabled"] as const)(
		"does not upload a stale catalog result after %s",
		async (transition) => {
			entries = [interval];
			const resolution = Promise.withResolvers<GameRelease | undefined>();
			const getRelease = vi
				.fn<Games["getRelease"]>()
				.mockReturnValue(resolution.promise);

			mount(undefined, getRelease);
			await vi.waitFor(() => expect(getRelease).toHaveBeenCalledOnce());

			if (transition === "unmount") {
				playTime?.unMount();
			} else if (transition === "signedOut") {
				accountStore.authorization.set(authorization("signedOut"));
			} else {
				playTimeSyncStore.isEnabled.set(false);
			}

			resolution.resolve(release);
			await resolution.promise;
			await Promise.resolve();

			expect(mocks.record).not.toHaveBeenCalled();
			expect(entries).toEqual([interval]);
		},
	);
});
