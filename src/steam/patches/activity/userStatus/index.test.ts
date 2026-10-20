import type { getActivityUser } from "@api/account";
import type { deleteComment, postComment } from "@api/activity";
import type {
	afterPatch,
	callOriginal,
	findModuleExport,
	replacePatch,
} from "@decky/ui";
import type { EResult } from "@decky/ui/dist/globals/steam-client/shared";
import type { Games } from "@steam/games";
import type { GameRelease } from "@steam/games/game";
import type { AppActivityStore } from "@steam/proxy/appActivityStore";
import type { AppStore } from "@steam/proxy/appStore";
import type { PlayerService } from "@steam/proxy/playerService";
import type { showErrorToast } from "@ui/toasts";
import type logger from "@utils/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";

type DeckyUiModule = {
	afterPatch: typeof afterPatch;
	callOriginal: typeof callOriginal;
	findModuleExport: typeof findModuleExport;
	replacePatch: typeof replacePatch;
	sleep: () => Promise<void>;
};
type AccountModule = { getActivityUser: typeof getActivityUser };
type ActivityModule = {
	deleteComment: typeof deleteComment;
	postComment: typeof postComment;
};
type SharedModule = { EResult: typeof EResult };
type AppActivityStoreModule = { AppActivityStore: typeof AppActivityStore };
type AppStoreModule = { AppStore: typeof AppStore };
type PlayerServiceModule = { PlayerService: typeof PlayerService };
type ToastModule = { showErrorToast: typeof showErrorToast };
type LoggerModule = { default: typeof logger };
type PatchCallback = (args: unknown[]) => unknown;

const mocks = vi.hoisted(() => {
	const callbacks = new Map<string, PatchCallback>();

	return {
		callbacks,
		callOriginal: Symbol("callOriginal"),
		deleteComment: vi.fn<typeof deleteComment>(),
		getPlayerService: vi.fn<() => unknown>(() => ({
			DeletePostedStatus: vi.fn<() => unknown>(),
			GetPostedStatus: vi.fn<() => unknown>(),
			PostStatusToFriends: vi.fn<() => unknown>(),
		})),
		getRelease: vi.fn<Games["getRelease"]>(),
		isAppShortcut: vi.fn<(appId: number) => boolean>(() => true),
		isSupported: vi.fn<(appId: number) => boolean>(() => false),
		postComment: vi.fn<typeof postComment>(),
		unpatch: vi.fn<() => void>(),
	};
});

vi.mock(
	import("@api/account"),
	() =>
		({
			getActivityUser: vi.fn<typeof getActivityUser>(),
		}) as unknown as AccountModule,
);

vi.mock(
	import("@api/activity"),
	() =>
		({
			deleteComment: mocks.deleteComment,
			postComment: mocks.postComment,
		}) as unknown as ActivityModule,
);

vi.mock(import("@api/rpc/result"), () => ({
	isSignInError: vi.fn<() => boolean>(() => false),
}));

vi.mock(
	import("@decky/ui"),
	() =>
		({
			afterPatch: vi.fn<typeof afterPatch>(),
			callOriginal: mocks.callOriginal,
			findModuleExport: vi.fn<typeof findModuleExport>(),
			replacePatch: vi.fn<
				(
					target: unknown,
					method: string,
					callback: PatchCallback,
				) => {
					original: () => unknown;
					unpatch: () => void;
				}
			>((_target: unknown, method: string, callback: PatchCallback) => {
				mocks.callbacks.set(method, callback);

				return { original: vi.fn<() => unknown>(), unpatch: mocks.unpatch };
			}),
			sleep: vi.fn<() => Promise<void>>(() => Promise.resolve()),
		}) as unknown as DeckyUiModule,
);

vi.mock(
	import("@decky/ui/dist/globals/steam-client/shared"),
	() => ({ EResult: { OK: 1 } }) as unknown as SharedModule,
);

vi.mock(
	import("@steam/proxy/appActivityStore"),
	() =>
		({
			AppActivityStore: {
				getCurrentUserSteamId: vi.fn<() => string | undefined>(),
			},
		}) as unknown as AppActivityStoreModule,
);

vi.mock(
	import("@steam/proxy/appStore"),
	() =>
		({
			AppStore: { isAppShortcut: mocks.isAppShortcut },
		}) as unknown as AppStoreModule,
);

vi.mock(
	import("@steam/proxy/playerService"),
	() =>
		({
			PlayerService: { getPlayerService: mocks.getPlayerService },
		}) as unknown as PlayerServiceModule,
);

vi.mock(
	import("@ui/toasts"),
	() =>
		({
			showErrorToast: vi.fn<typeof showErrorToast>(),
		}) as unknown as ToastModule,
);

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: { error: vi.fn<(...args: unknown[]) => void>() },
		}) as unknown as LoggerModule,
);

import { UserStatusPatcher } from ".";

const APP_ID = 123;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.callbacks.clear();
	mocks.isAppShortcut.mockReturnValue(true);
	mocks.getRelease.mockReset();
});

describe("UserStatusPatcher", () => {
	it("passes unsupported shortcut posts through to Steam without calling Activity", async () => {
		const patcher = new UserStatusPatcher({
			getRelease: vi.fn<Games["getRelease"]>(),
			isSupported: mocks.isSupported,
		} as unknown as Games);

		await vi.waitFor(() =>
			expect(mocks.callbacks.get("PostStatusToFriends")).toBeTypeOf("function"),
		);

		const result = mocks.callbacks.get("PostStatusToFriends")?.([
			undefined,
			{ Body: () => ({ appid: () => APP_ID, status_text: () => "Hello" }) },
		]);

		expect(result).toBe(mocks.callOriginal);
		expect(mocks.postComment).not.toHaveBeenCalled();
		patcher.unMount();
	});

	it("does not delete a shortcut comment whose Activity release is unpublished", async () => {
		mocks.getRelease.mockResolvedValue({
			gameId: "game",
			revisionId: "revision",
		} as GameRelease);

		const patcher = new UserStatusPatcher({
			getRelease: mocks.getRelease,
			isSupported: mocks.isSupported,
		} as unknown as Games);

		await vi.waitFor(() =>
			expect(mocks.callbacks.get("DeletePostedStatus")).toBeTypeOf("function"),
		);

		patcher.register({
			accountId: 1,
			appId: APP_ID,
			commentId: "comment",
			ownedByCurrentUser: true,
			postId: "post",
			statusText: "Hello",
			steamId: "steam",
		});

		await mocks.callbacks.get("DeletePostedStatus")?.([
			undefined,
			{ Body: () => ({ postid: () => "post" }) },
		]);

		expect(mocks.getRelease).toHaveBeenCalledExactlyOnceWith(APP_ID);
		expect(mocks.deleteComment).not.toHaveBeenCalled();
		patcher.unMount();
	});
});
