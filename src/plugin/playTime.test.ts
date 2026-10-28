import type { DeviceAuthorizationStatus } from "@api/account";
import type { Games } from "@steam/games";
import { GameRelease } from "@steam/games/game";
import { LifetimeScope } from "@steam/lifetimeScope";
import { playTimeSyncStore } from "@stores/playTimeSync";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayTime } from "./playTime";

const mocks = vi.hoisted(() => ({
	record: vi.fn<() => Promise<{ data: unknown; ok: true }>>(),
	authorization:
		vi.fn<() => undefined | { status: DeviceAuthorizationStatus }>(),
}));

vi.mock(
	import("@api/activity"),
	() => ({ recordPlaytime: mocks.record }) as never,
);

vi.mock(import("@api/settings"), () => ({}) as never);

vi.mock(
	import("@stores/account"),
	() =>
		({
			accountStore: { authorization: { peek: mocks.authorization } },
		}) as never,
);

vi.mock(
	import("@utils/logger"),
	() => ({ default: { error: vi.fn<() => void>() } }) as never,
);

const release = GameRelease.fromAnswer({
	gameId: "game",
	gameIdentityMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	releaseId: "release",
	releaseRevisionId: "version",
});

const STARTED_AT = 1000;
const ENDED_AT = 2000;

function commit(): void {
	window.dispatchEvent(
		new CustomEvent("playtime:interval-committed:v1", {
			detail: {
				endedAt: ENDED_AT,
				game: { id: "42", name: "Game" },
				startedAt: STARTED_AT,
			},
		}),
	);
}

let scope: LifetimeScope;

beforeEach(() => {
	vi.stubGlobal("window", new EventTarget());
	mocks.record.mockReset();
	mocks.record.mockResolvedValue({ data: undefined, ok: true });
	mocks.authorization.mockReturnValue({ status: "signedIn" });
	playTimeSyncStore.isEnabled.set(true);
	scope = new LifetimeScope("PlayTime test");
});

afterEach(() => {
	scope.unMount();
	vi.unstubAllGlobals();
});

describe("PlayTime sharing choice", () => {
	it("records a recognised interval once the user opted in", async () => {
		const getRelease = vi.fn<Games["getRelease"]>().mockResolvedValue(release);

		scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
		commit();

		await vi.waitFor(() => {
			expect(mocks.record).toHaveBeenCalledWith(
				"game",
				"release",
				"version",
				STARTED_AT,
				ENDED_AT,
			);
		});
	});

	it("does not submit when sharing is disabled during recognition", async () => {
		const pending = Promise.withResolvers<GameRelease | undefined>();
		const getRelease = vi.fn<Games["getRelease"]>(() => pending.promise);

		scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
		commit();
		await vi.waitFor(() => {
			expect(getRelease).toHaveBeenCalled();
		});

		playTimeSyncStore.isEnabled.set(false);
		pending.resolve(release);
		await pending.promise;
		await Promise.resolve();

		expect(mocks.record).not.toHaveBeenCalled();
	});

	it("neither recognises nor records intervals while signed out of Activity", async () => {
		const getRelease = vi.fn<Games["getRelease"]>().mockResolvedValue(release);

		mocks.authorization.mockReturnValue({ status: "signedOut" });
		scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
		commit();
		await Promise.resolve();

		expect(getRelease).not.toHaveBeenCalled();
		expect(mocks.record).not.toHaveBeenCalled();
	});

	it("does not submit when Activity signs out during recognition", async () => {
		const pending = Promise.withResolvers<GameRelease | undefined>();
		const getRelease = vi.fn<Games["getRelease"]>(() => pending.promise);

		scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
		commit();
		await vi.waitFor(() => {
			expect(getRelease).toHaveBeenCalled();
		});

		mocks.authorization.mockReturnValue({ status: "signedOut" });
		pending.resolve(release);
		await pending.promise;
		await Promise.resolve();

		expect(mocks.record).not.toHaveBeenCalled();
	});

	it.each([false, undefined])(
		"neither recognises nor records an interval while sharing is off or loading: %s",
		async (isEnabled) => {
			const getRelease = vi
				.fn<Games["getRelease"]>()
				.mockResolvedValue(release);

			playTimeSyncStore.isEnabled.set(isEnabled);
			scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
			commit();
			await Promise.resolve();

			expect(getRelease).not.toHaveBeenCalled();
			expect(mocks.record).not.toHaveBeenCalled();
		},
	);
});

describe("PlayTime session lifetime", () => {
	it("does not submit an interval when recognition finishes after logout", async () => {
		const pending = Promise.withResolvers<GameRelease | undefined>();
		const getRelease = vi.fn<Games["getRelease"]>(() => pending.promise);

		scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
		commit();
		await vi.waitFor(() => {
			expect(getRelease).toHaveBeenCalled();
		});

		scope.unMount();
		pending.resolve(release);
		await pending.promise;
		await Promise.resolve();

		expect(mocks.record).not.toHaveBeenCalled();
	});

	it("stops consuming events after logout", () => {
		const getRelease = vi.fn<Games["getRelease"]>();

		scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
		scope.unMount();
		commit();

		expect(getRelease).not.toHaveBeenCalled();
	});

	it.each([
		undefined,
		GameRelease.fromAnswer({
			gameId: "game",
			gameIdentityMd5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
			// oxlint-disable-next-line unicorn/no-null -- The catalog reports unpublished releases as null.
			releaseId: null,
			releaseRevisionId: "version",
		}),
	])(
		"does not submit an unidentified or unpublished release: %s",
		async (answer) => {
			const getRelease = vi.fn<Games["getRelease"]>().mockResolvedValue(answer);

			scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
			commit();
			await vi.waitFor(() => {
				expect(getRelease).toHaveBeenCalled();
			});

			await Promise.resolve();
			await Promise.resolve();

			expect(mocks.record).not.toHaveBeenCalled();
		},
	);
});
