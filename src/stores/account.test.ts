import type { DeviceAuthorizationState } from "@api/account";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LifetimeScope } from "../steam/lifetimeScope";
import type { accountStore, refreshActivityAccount } from "./account";

const boundary = vi.hoisted(() => ({
	getDeviceAuthorization: vi.fn<() => Promise<unknown>>(),
	authorizationListener: undefined as unknown,
	syncRetroAchievementsCredentials:
		vi.fn<() => Promise<DeviceAuthorizationState>>(),
}));

vi.mock(
	import("@api/account"),
	() =>
		({
			authorizationGate: { onSignInRequired: () => () => undefined },
			cancelDeviceAuthorization:
				vi.fn<() => Promise<DeviceAuthorizationState>>(),
			getActivityUser: vi.fn<() => Promise<unknown>>(),
			getDeviceAuthorization: boundary.getDeviceAuthorization,
			onDeviceAuthorizationChanged(
				listener: (state: DeviceAuthorizationState) => void,
			) {
				boundary.authorizationListener = listener;

				return () => {
					boundary.authorizationListener = undefined;
				};
			},
			signOutActivity: vi.fn<() => Promise<DeviceAuthorizationState>>(),
			startDeviceAuthorization:
				vi.fn<() => Promise<DeviceAuthorizationState>>(),
			syncRetroAchievementsCredentials:
				boundary.syncRetroAchievementsCredentials,
		}) as never,
);

vi.mock(
	import("@pages/routes"),
	() =>
		({
			navigateTo: vi.fn<() => void>(),
			ROUTES: { signIn: "/sign-in" },
		}) as never,
);

vi.mock(
	import("@ui/toasts"),
	() =>
		({
			showErrorToast: vi.fn<() => void>(),
			showSignInRequiredToast: vi.fn<() => void>(),
			showSuccessToast: vi.fn<() => void>(),
		}) as never,
);

vi.mock(
	import("@utils/logger"),
	() => ({ default: { error: vi.fn<() => void>() } }) as never,
);

const SIGNED_OUT: DeviceAuthorizationState = {
	accessTokensUrl: "",
	codeExpiresAt: 0,
	message: "",
	retroAchievementsLinked: false,
	retroAchievementsCredentialSync: false,
	status: "signedOut",
	tokenExpiresAt: "",
	userCode: "",
	verificationUri: "",
	verificationUriComplete: "",
};

const PENDING: DeviceAuthorizationState = {
	...SIGNED_OUT,
	codeExpiresAt: 2000,
	status: "pending",
};

const SIGNED_IN: DeviceAuthorizationState = {
	...SIGNED_OUT,
	retroAchievementsCredentialSync: true,
	status: "signedIn",
	tokenExpiresAt: "2999-01-01T00:00:00Z",
};

let activeScope: LifetimeScope | undefined;

async function mountAccount(initialRead: Promise<unknown>): Promise<{
	accountStore: typeof accountStore;
	refreshActivityAccount: typeof refreshActivityAccount;
}> {
	boundary.getDeviceAuthorization.mockReturnValueOnce(initialRead);

	const account = await import("./account");
	const { LifetimeScope: Scope } = await import("../steam/lifetimeScope");

	activeScope = new Scope("account-store-test");
	account.mountActivityAccount(activeScope);

	await Promise.resolve();
	await Promise.resolve();

	return account;
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	boundary.getDeviceAuthorization.mockReset();
	boundary.authorizationListener = undefined;
	boundary.syncRetroAchievementsCredentials.mockReset();
});

afterEach(() => {
	activeScope?.unMount();
	activeScope = undefined;
});

describe("refreshActivityAccount", () => {
	it("clears the previous load error as soon as a retry starts", async () => {
		const initialRead = Promise.withResolvers<unknown>();
		const account = await mountAccount(initialRead.promise);

		initialRead.reject(new Error("initial load failed"));
		await Promise.resolve();
		await Promise.resolve();
		expect(account.accountStore.loadError.peek()).toBe(
			"Could not load the Activity account.",
		);

		const retry = Promise.withResolvers<unknown>();

		boundary.getDeviceAuthorization.mockReturnValueOnce(retry.promise);
		const refresh = account.refreshActivityAccount();

		expect(account.accountStore.loadError.peek()).toBeUndefined();

		retry.resolve(SIGNED_OUT);
		await expect(refresh).resolves.toEqual(SIGNED_OUT);
	});

	it("returns a newer event snapshot when an older refresh fails", async () => {
		const account = await mountAccount(Promise.resolve(SIGNED_OUT));
		const staleRead = Promise.withResolvers<unknown>();

		boundary.getDeviceAuthorization.mockReturnValueOnce(staleRead.promise);
		const refresh = account.refreshActivityAccount();

		const listener = boundary.authorizationListener as
			| ((state: DeviceAuthorizationState) => void)
			| undefined;

		expect(listener).toBeDefined();
		listener?.(PENDING);

		staleRead.reject(new Error("stale read failed"));
		await expect(refresh).resolves.toEqual(PENDING);
		expect(account.accountStore.loadError.peek()).toBeUndefined();
	});

	it("refreshes credentials once on sign-in without reviving a newer signed-out snapshot", async () => {
		const refreshed = Promise.withResolvers<DeviceAuthorizationState>();

		boundary.syncRetroAchievementsCredentials.mockReturnValue(refreshed.promise);
		const account = await mountAccount(Promise.resolve(SIGNED_IN));

		expect(boundary.syncRetroAchievementsCredentials).toHaveBeenCalledOnce();

		const listener = boundary.authorizationListener as
			| ((state: DeviceAuthorizationState) => void)
			| undefined;

		listener?.(SIGNED_OUT);
		refreshed.resolve({ ...SIGNED_IN, retroAchievementsLinked: true });
		await refreshed.promise;
		await Promise.resolve();

		expect(account.accountStore.authorization.peek()).toEqual(SIGNED_OUT);
		expect(boundary.syncRetroAchievementsCredentials).toHaveBeenCalledOnce();
	});

	it("refreshes credentials once for each transition into signed-in", async () => {
		boundary.syncRetroAchievementsCredentials.mockResolvedValue(SIGNED_IN);
		await mountAccount(Promise.resolve(SIGNED_OUT));

		const listener = boundary.authorizationListener as
			| ((state: DeviceAuthorizationState) => void)
			| undefined;

		listener?.(SIGNED_IN);
		await Promise.resolve();
		expect(boundary.syncRetroAchievementsCredentials).toHaveBeenCalledOnce();

		listener?.(SIGNED_IN);
		await Promise.resolve();
		expect(boundary.syncRetroAchievementsCredentials).toHaveBeenCalledOnce();

		listener?.(SIGNED_OUT);
		listener?.(SIGNED_IN);
		await Promise.resolve();
		expect(boundary.syncRetroAchievementsCredentials).toHaveBeenCalledTimes(2);
	});
});
