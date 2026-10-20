import type {
	DeviceAuthorizationState,
	getActivityUser,
	startDeviceAuthorization,
} from "@api/account";
import type { deleteComment, getActivity, postComment } from "@api/activity";
import type { recognizeGames } from "@api/catalog";
import { TimeoutError } from "es-toolkit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthorizationGate } from "./authorizationGate";
import { RPC_TIMEOUT_MS } from "./transport";

const UNAUTHORIZED_STATUS = 401;

const boundary = vi.hoisted(() => ({
	prompt: vi.fn<() => void>(),
	request: vi.fn<(name: string, args: unknown[]) => Promise<unknown>>(),
}));

vi.mock(
	import("@decky/api"),
	() =>
		({
			callable:
				(name: string) =>
				(...args: unknown[]) =>
					boundary.request(name, args),
		}) as never,
);

vi.mock(
	import("@utils/logger"),
	() => ({ default: { error: vi.fn<() => void>() } }) as never,
);

const authorization = (
	status: DeviceAuthorizationState["status"],
): DeviceAuthorizationState => {
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
};

let state: DeviceAuthorizationState;

function dispatched(): unknown[][] {
	return boundary.request.mock.calls.filter(
		([name]) => name !== "get_device_authorization",
	);
}

function preflights(): number {
	return boundary.request.mock.calls.filter(
		([name]) => name === "get_device_authorization",
	).length;
}

type Api = Readonly<{
	account: Readonly<{
		getActivityUser: typeof getActivityUser;
		startDeviceAuthorization: typeof startDeviceAuthorization;
	}>;
	activity: Readonly<{
		deleteComment: typeof deleteComment;
		getActivity: typeof getActivity;
		postComment: typeof postComment;
	}>;
	catalog: Readonly<{ recognizeGames: typeof recognizeGames }>;
}>;

async function loadApi(): Promise<Api> {
	const account = await import("@api/account");

	account.authorizationGate.onSignInRequired(boundary.prompt);

	return {
		account,
		activity: await import("@api/activity"),
		catalog: await import("@api/catalog"),
	};
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	state = authorization("signedOut");
	boundary.request.mockImplementation(async (name) => {
		if (name === "get_device_authorization") {
			return state;
		}

		return { data: { id: "comment" }, ok: true };
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("Activity account request guard", () => {
	it.each([
		"signedOut",
		"starting",
		"pending",
		"denied",
		"expired",
		"error",
	] as const)(
		"blocks every protected RPC and asks for sign-in when authorization is %s",
		async (status) => {
			state = authorization(status);
			const { account, activity, catalog } = await loadApi();
			const results = await Promise.all([
				activity.getActivity("game", "release", "revision"),
				activity.postComment("game", "release", "revision", "hello"),
				activity.deleteComment("game", "release", "revision", "comment"),
				account.getActivityUser(),
				catalog.recognizeGames([]),
			]);

			expect(results).toEqual([
				{ error: "notSignedIn", ok: false, status: 0 },
				{ error: "notSignedIn", ok: false, status: 0 },
				{ error: "notSignedIn", ok: false, status: 0 },
				// oxlint-disable-next-line unicorn/no-null -- The profile RPC returns null while signed out.
				null,
				[],
			]);

			expect(dispatched()).toEqual([]);
			expect(boundary.prompt).toHaveBeenCalledTimes(results.length);
		},
	);

	it.each(["notSignedIn", "unauthorized"] as const)(
		"asks for sign-in when the backend answers %s after the local check passed",
		async (code) => {
			state = authorization("signedIn");
			const { activity } = await loadApi();
			let status = 0;

			if (code === "unauthorized") {
				status = UNAUTHORIZED_STATUS;
			}

			const failure = {
				error: code,
				ok: false,
				status,
			};

			boundary.request.mockImplementation(async (name) => {
				if (name === "get_device_authorization") {
					return state;
				}

				return failure;
			});

			expect(await activity.getActivity("game", "release", "revision")).toEqual(
				failure,
			);

			expect(boundary.prompt).toHaveBeenCalledOnce();
		},
	);

	it("passes other API failures through without a sign-in prompt", async () => {
		state = authorization("signedIn");
		const { activity } = await loadApi();
		const failure = { error: "httpError", ok: false, status: 500 };

		boundary.request.mockImplementation(async (name) => {
			if (name === "get_device_authorization") {
				return state;
			}

			return failure;
		});

		expect(
			await activity.deleteComment("game", "release", "revision", "comment"),
		).toEqual(failure);

		expect(boundary.prompt).not.toHaveBeenCalled();
	});

	it("rechecks authorization per request, so a sign-out blocks the next call", async () => {
		state = authorization("signedIn");
		const { activity } = await loadApi();

		expect(
			await activity.postComment("game", "release", "revision", "hello"),
		).toEqual({
			data: { id: "comment" },
			ok: true,
		});

		expect(boundary.request).toHaveBeenCalledWith("post_comment", [
			"game",
			"release",
			"revision",
			"hello",
		]);

		state = authorization("signedOut");
		boundary.request.mockClear();
		expect(
			await activity.deleteComment("game", "release", "revision", "comment"),
		).toEqual({
			error: "notSignedIn",
			ok: false,
			status: 0,
		});

		expect(dispatched()).toEqual([]);
		expect(boundary.prompt).toHaveBeenCalledOnce();
	});

	it("resolves unreachable without dispatching when the authorization read fails", async () => {
		const { activity } = await loadApi();

		boundary.request.mockRejectedValue(new Error("Decky unavailable"));

		expect(
			await activity.deleteComment("game", "release", "revision", "comment"),
		).toEqual({
			error: "unreachable",
			ok: false,
			status: 0,
		});

		expect(dispatched()).toEqual([]);
		expect(boundary.prompt).not.toHaveBeenCalled();
	});

	it("resolves unreachable when a protected request rejects", async () => {
		state = authorization("signedIn");
		const { activity } = await loadApi();

		boundary.request.mockImplementation(async (name) => {
			if (name === "get_device_authorization") {
				return state;
			}

			throw new Error("backend handler crashed");
		});

		expect(
			await activity.postComment("game", "release", "revision", "hello"),
		).toEqual({
			error: "unreachable",
			ok: false,
			status: 0,
		});
	});

	it("shares one in-flight authorization check between concurrent calls, then checks again", async () => {
		state = authorization("signedIn");
		const { account, activity, catalog } = await loadApi();
		const pending = Promise.withResolvers<DeviceAuthorizationState>();

		boundary.request.mockImplementation(async (name) => {
			if (name === "get_device_authorization") {
				return pending.promise;
			}

			return { data: undefined, ok: true };
		});

		const calls = [
			activity.getActivity("game", "release", "revision"),
			activity.deleteComment("game", "release", "revision", "comment"),
			account.getActivityUser(),
			catalog.recognizeGames([]),
		];

		pending.resolve(state);
		await Promise.all(calls);
		expect(preflights()).toBe(1);
		expect(dispatched()).toHaveLength(calls.length);

		await activity.deleteComment("game", "release", "revision", "comment");
		expect(preflights()).toBe(2);
	});

	it("resolves unreachable when a protected request never answers", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		state = authorization("signedIn");
		const { activity } = await loadApi();

		boundary.request.mockImplementation(async (name) => {
			if (name === "get_device_authorization") {
				return state;
			}

			return Promise.withResolvers<never>().promise;
		});

		const result = activity.getActivity("game", "release", "revision");

		await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS);
		expect(await result).toEqual({
			error: "unreachable",
			ok: false,
			status: 0,
		});
	});

	it("rejects a fallback RPC with a timeout when it never answers", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		state = authorization("signedIn");
		const { catalog } = await loadApi();

		boundary.request.mockImplementation(async (name) => {
			if (name === "get_device_authorization") {
				return state;
			}

			return Promise.withResolvers<never>().promise;
		});

		await Promise.all([
			expect(catalog.recognizeGames([])).rejects.toBeInstanceOf(TimeoutError),
			vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS),
		]);
	});

	it("bounds the authorization check and the request with one shared deadline", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		state = authorization("signedIn");
		const { activity } = await loadApi();
		const preflight = Promise.withResolvers<DeviceAuthorizationState>();

		boundary.request.mockImplementation(async (name) => {
			if (name === "get_device_authorization") {
				return preflight.promise;
			}

			return Promise.withResolvers<never>().promise;
		});

		let outcome: unknown = "pending";
		const settled = (async () => {
			outcome = await activity.getActivity("game", "release", "revision");
		})();

		await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS - 1);
		preflight.resolve(state);
		await vi.advanceTimersByTimeAsync(0);
		expect(dispatched()).toHaveLength(1);
		expect(outcome).toBe("pending");

		await vi.advanceTimersByTimeAsync(1);
		await settled;
		expect(outcome).toEqual({ error: "unreachable", ok: false, status: 0 });
	});

	it("neither dispatches nor prompts once the caller's deadline passed during the authorization check", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const preflight = Promise.withResolvers<boolean>();
		const gate = new AuthorizationGate(async () => preflight.promise);

		gate.onSignInRequired(boundary.prompt);

		const getFeed = gate.guardResult("get_activity");
		// oxlint-disable-next-line unicorn/no-null -- The profile RPC returns null while signed out.
		const getUser = gate.guard("get_activity_user", () => null);
		const feed = getFeed("game", "release", "revision");
		const user = getUser();

		await Promise.all([
			expect(feed).resolves.toEqual({
				error: "unreachable",
				ok: false,
				status: 0,
			}),
			expect(user).rejects.toBeInstanceOf(TimeoutError),
			vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS),
		]);

		preflight.resolve(true);
		await vi.advanceTimersByTimeAsync(0);
		expect(boundary.request).not.toHaveBeenCalled();
		expect(boundary.prompt).not.toHaveBeenCalled();
	});

	it("reports a comment the backend posts after the RPC deadline as posted, not failed", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		state = authorization("signedIn");
		const { activity } = await loadApi();
		const posted = Promise.withResolvers<unknown>();

		boundary.request.mockImplementation(async (name) => {
			if (name === "get_device_authorization") {
				return state;
			}

			return posted.promise;
		});

		let outcome: unknown = "pending";
		const settled = (async () => {
			outcome = await activity.postComment(
				"game",
				"release",
				"revision",
				"hello",
			);
		})();

		await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS * 2);
		expect(outcome).toBe("pending");

		posted.resolve({ data: { id: "comment" }, ok: true });
		await settled;
		expect(outcome).toEqual({ data: { id: "comment" }, ok: true });
	});

	it("does not dispatch a mutation when the authorization check never answers", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const { activity } = await loadApi();

		boundary.request.mockReturnValue(Promise.withResolvers<never>().promise);

		await Promise.all([
			expect(
				activity.deleteComment("game", "release", "revision", "comment"),
			).resolves.toEqual({
				error: "unreachable",
				ok: false,
				status: 0,
			}),
			vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS),
		]);

		expect(dispatched()).toEqual([]);
	});

	it("keeps explicit device sign-in available without an active account", async () => {
		const { account } = await loadApi();

		boundary.request.mockResolvedValue(authorization("starting"));
		expect(await account.startDeviceAuthorization()).toEqual(
			authorization("starting"),
		);

		expect(boundary.request).toHaveBeenCalledExactlyOnceWith(
			"start_device_authorization",
			[],
		);

		expect(boundary.prompt).not.toHaveBeenCalled();
	});
});
