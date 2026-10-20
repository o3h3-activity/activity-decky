import type { DeviceAuthorizationState } from "@api/account";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type PluginDefinition = { onDismount(): void };

const mocks = vi.hoisted(() => {
	const instance = {
		mount: vi.fn<() => void>(),
		unMount: vi.fn<() => void>(),
	};

	function Steam(): typeof instance {
		return instance;
	}

	return {
		factory: undefined as (() => PluginDefinition) | undefined,
		instance,
		handshake: vi.fn<() => Promise<boolean>>(),
		authorization: vi.fn<() => Promise<DeviceAuthorizationState>>(),
		recognize: vi.fn<() => Promise<unknown[]>>(),
		toast: vi.fn<(message: { body: string; title: string }) => void>(),
		steam: Steam,
	};
});

vi.mock(
	import("@decky/api"),
	() =>
		({
			addEventListener: vi.fn<() => () => void>(() => () => undefined),
			removeEventListener: vi.fn<() => void>(),
			definePlugin(factory: () => PluginDefinition) {
				mocks.factory = factory;

				return factory;
			},
			callable(name: string) {
				switch (name) {
					case "game_anatomy_handshake": {
						return mocks.handshake;
					}

					case "get_device_authorization": {
						return mocks.authorization;
					}

					case "get_debug_enabled": {
						return async () => undefined;
					}

					default: {
						return mocks.recognize;
					}
				}
			},
			toaster: { toast: mocks.toast },
		}) as never,
);

vi.mock(
	import("@decky/ui"),
	() => ({ staticClasses: { Title: "Title" } }) as never,
);

vi.mock(
	import("@pages"),
	() => ({ registerPages: vi.fn<() => void>() }) as never,
);

vi.mock(
	import("@ui/tailwind"),
	() => ({ injectTailwind: vi.fn<() => void>() }) as never,
);

vi.mock(
	import("@pages/quick-access-menu"),
	() => ({ ActivitySettings: () => undefined }) as never,
);

vi.mock(
	import("react-icons/md"),
	() => ({ MdGamepad: () => undefined }) as never,
);

vi.mock(
	import("nanoevents"),
	() => ({ createNanoEvents: vi.fn<() => object>(() => ({})) }) as never,
);

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: {
				error: vi.fn<() => void>(),
				info: vi.fn<() => void>(),
				once: { clear: vi.fn<() => void>() },
			},
			setDebugEnabled: vi.fn<() => void>(),
		}) as never,
);

vi.mock(import("@steam"), () => ({ Steam: mocks.steam }) as never);

async function mountPlugin(): Promise<PluginDefinition> {
	// Re-import to execute the plugin registration boundary independently per test.
	await import("./index");

	if (mocks.factory === undefined) {
		throw new Error("Plugin factory was not registered");
	}

	return mocks.factory();
}

function authorizationState(
	status: DeviceAuthorizationState["status"],
): DeviceAuthorizationState {
	let tokenExpiresAt = "";

	if (status === "signedIn") {
		tokenExpiresAt = "2999-01-01T00:00:00Z";
	}

	return {
		accessTokensUrl: "",
		codeExpiresAt: 0,
		message: "",
		retroAchievementsLinked: false,
		status,
		tokenExpiresAt,
		userCode: "",
		verificationUri: "",
		verificationUriComplete: "",
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.stubGlobal("window", new EventTarget());
	mocks.factory = undefined;
	mocks.handshake.mockResolvedValue(true);
	mocks.authorization.mockResolvedValue(authorizationState("signedIn"));
	mocks.recognize.mockResolvedValue([]);
	vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("mount-time Activity login prompt", () => {
	it("prompts when signed out without waiting for the native handshake", async () => {
		mocks.authorization.mockResolvedValue(authorizationState("signedOut"));
		mocks.handshake.mockReturnValue(Promise.withResolvers<boolean>().promise);
		await mountPlugin();

		await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
		expect(mocks.toast.mock.calls[0]?.[0].body).toMatch(/sign in/iu);
	});

	it("shares the mount prompt cooldown with blocked game recognition", async () => {
		mocks.authorization.mockResolvedValue(authorizationState("signedOut"));
		await mountPlugin();

		await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
		const { recognizeGames } = await import("@api/catalog");
		const result = await recognizeGames([
			{
				appId: 1,
				game_identity_md5: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
				platform: "ps1",
				rcheevos_id: 12,
				serial: "SLUS-00001",
			},
		]);

		expect(result).toEqual([]);
		expect(mocks.recognize).not.toHaveBeenCalled();
		expect(mocks.toast).toHaveBeenCalledOnce();
	});

	it("does not prompt when already signed in", async () => {
		await mountPlugin();
		expect(mocks.toast).not.toHaveBeenCalled();
	});

	it("does not prompt after dismount when the account check finishes late", async () => {
		const authorization = Promise.withResolvers<DeviceAuthorizationState>();

		mocks.authorization.mockReturnValue(authorization.promise);
		const plugin = await mountPlugin();

		plugin.onDismount();
		authorization.resolve(authorizationState("signedOut"));
		await Promise.resolve();
		await Promise.resolve();
		expect(mocks.toast).not.toHaveBeenCalled();
	});

	it("does not mistake an unavailable account check for being signed out", async () => {
		mocks.authorization.mockRejectedValue(new Error("Decky unavailable"));
		await mountPlugin();
		expect(mocks.toast).not.toHaveBeenCalled();
	});
});

describe("plugin game-anatomy startup check", () => {
	it("reports a negative handshake", async () => {
		mocks.handshake.mockResolvedValue(false);
		await mountPlugin();

		await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
	});

	it("reports a rejected handshake", async () => {
		mocks.handshake.mockRejectedValue(new Error("native unavailable"));
		await mountPlugin();

		await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalledOnce());
	});

	it("does not report a handshake that rejects after dismount", async () => {
		const handshake = Promise.withResolvers<boolean>();

		mocks.handshake.mockReturnValue(handshake.promise);
		const plugin = await mountPlugin();

		plugin.onDismount();
		handshake.reject(new Error("native unavailable"));
		await vi.waitFor(() =>
			expect(mocks.instance.unMount).toHaveBeenCalledOnce(),
		);

		await Promise.resolve();
		await Promise.resolve();
		expect(mocks.toast).not.toHaveBeenCalled();
	});
});
