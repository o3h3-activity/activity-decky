import type { Games } from "@steam/games";
import { GameRelease } from "@steam/games/game";
import { LifetimeScope } from "@steam/lifetimeScope";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayTime } from "./playTime";

const mocks = vi.hoisted(() => ({
	record: vi.fn<() => Promise<{ data: unknown; ok: true }>>(),
}));

vi.mock(import("@api/activity"), () => ({ recordPlaytime: mocks.record }) as never);
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

function commit(): void {
	window.dispatchEvent(
		new CustomEvent("playtime:interval-committed:v1", {
			detail: {
				endedAt: 2000,
				game: { id: "42", name: "Game" },
				startedAt: 1000,
			},
		}),
	);
}

let scope: LifetimeScope;

beforeEach(() => {
	vi.stubGlobal("window", new EventTarget());
	mocks.record.mockReset();
	mocks.record.mockResolvedValue({ data: undefined, ok: true });
	scope = new LifetimeScope("PlayTime test");
});

afterEach(() => {
	scope.unMount();
	vi.unstubAllGlobals();
});

describe("PlayTime session lifetime", () => {
	it("does not submit an interval when recognition finishes after logout", async () => {
		const pending = Promise.withResolvers<GameRelease | undefined>();
		const getRelease = vi.fn<Games["getRelease"]>(() => pending.promise);

		scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
		commit();
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
	])("does not submit an unidentified or unpublished release: %s", async (answer) => {
		const getRelease = vi.fn<Games["getRelease"]>().mockResolvedValue(answer);

		scope.track(new PlayTime({ getRelease } as unknown as Games)).mount();
		commit();
		await Promise.resolve();
		await Promise.resolve();

		expect(mocks.record).not.toHaveBeenCalled();
	});
});
