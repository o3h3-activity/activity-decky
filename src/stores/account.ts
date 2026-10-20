import {
	type ActivityUser,
	authorizationGate,
	cancelDeviceAuthorization,
	type DeviceAuthorizationState,
	type DeviceAuthorizationStatus,
	getActivityUser,
	getDeviceAuthorization,
	onDeviceAuthorizationChanged,
	signOutActivity,
	startDeviceAuthorization,
} from "@api/account";
import { batch, observable } from "@legendapp/state";
import { navigateTo, ROUTES } from "@pages/routes";
import type { LifetimeScope } from "@steam/lifetimeScope";
import {
	showErrorToast,
	showSignInRequiredToast,
	showSuccessToast,
} from "@ui/toasts";
import logger from "@utils/logger";

/** `none` outside a signed-in session; `failed` when the profile request failed or returned no user. */
export type ProfileStatus = "failed" | "loaded" | "loading" | "none";

type AccountStore = {
	/** Latest backend snapshot; undefined until the first successful load. */
	authorization: DeviceAuthorizationState | undefined;
	/** A start, cancel or sign-out request is in flight. */
	isBusy: boolean;
	/** Why the latest load failed; cleared by the next snapshot. */
	loadError: string | undefined;
	profile: ActivityUser | undefined;
	profileStatus: ProfileStatus;
};

const ACCOUNT_LOAD_ERROR = "Could not load the Activity account.";

/** Plugin-wide Activity account state; only this module writes it, components read it. */
export const accountStore = observable<AccountStore>({
	authorization: undefined,
	isBusy: false,
	loadError: undefined,
	profile: undefined,
	profileStatus: "none",
});

let lifetime: LifetimeScope | undefined;
/** Bumped per applied snapshot, so a response overtaken by a newer snapshot is dropped. */
let snapshotVersion = 0;
/** Bumped per profile request or reset, so only the latest request lands. */
let profileVersion = 0;

function isLive(): boolean {
	return lifetime !== undefined && !lifetime.signal.aborted;
}

export function isSignInInProgress(
	status: DeviceAuthorizationStatus | undefined,
): boolean {
	return status === "starting" || status === "pending";
}

function openSignInPage(): void {
	navigateTo(ROUTES.signIn);
}

/** Silent while a sign-in is already in progress: the user is acting on it. */
function promptSignIn(): void {
	if (!isSignInInProgress(accountStore.authorization.peek()?.status)) {
		showSignInRequiredToast(openSignInPage);
	}
}

function resetProfile(): void {
	profileVersion += 1;
	batch(() => {
		accountStore.profile.set(undefined);
		accountStore.profileStatus.set("none");
	});
}

async function loadProfile(announceSignIn: boolean): Promise<void> {
	profileVersion += 1;
	const requestVersion = profileVersion;
	let profile: ActivityUser | undefined;

	accountStore.profileStatus.set("loading");

	try {
		profile = (await getActivityUser()) ?? undefined;
	} catch (error: unknown) {
		logger.error("[activity] Could not load Activity user", error);
	}

	if (!isLive() || requestVersion !== profileVersion) {
		return;
	}

	batch(() => {
		accountStore.profile.set(profile);

		if (profile === undefined) {
			accountStore.profileStatus.set("failed");
		} else {
			accountStore.profileStatus.set("loaded");
		}
	});

	if (announceSignIn) {
		if (profile === undefined) {
			showSuccessToast("Signed in to Activity.");
		} else {
			showSuccessToast(`Signed in as ${profile.nickname}.`);
		}
	}
}

function applySnapshot(next: DeviceAuthorizationState): void {
	const previousStatus = accountStore.authorization.peek()?.status;

	snapshotVersion += 1;
	batch(() => {
		accountStore.authorization.set(next);
		accountStore.loadError.set(undefined);
	});

	if (next.status !== "signedIn") {
		if (accountStore.profileStatus.peek() !== "none") {
			resetProfile();
		}

		return;
	}

	if (previousStatus !== "signedIn") {
		void loadProfile(isSignInInProgress(previousStatus));
	}
}

/**
 * Reloads the backend snapshot; the backend rechecks a signed-in token on every read.
 * Resolves the current snapshot, or undefined when the load failed or the plugin unmounted.
 */
export async function refreshActivityAccount(): Promise<
	DeviceAuthorizationState | undefined
> {
	const requestVersion = snapshotVersion;

	accountStore.loadError.set(undefined);

	try {
		const current = await getDeviceAuthorization();

		if (!isLive()) {
			return undefined;
		}

		if (requestVersion === snapshotVersion) {
			applySnapshot(current);
		}

		return accountStore.authorization.peek();
	} catch (error: unknown) {
		if (!isLive()) {
			return undefined;
		}

		logger.error("[activity] Could not load Activity account", error);

		if (requestVersion !== snapshotVersion) {
			return accountStore.authorization.peek();
		}

		accountStore.loadError.set(ACCOUNT_LOAD_ERROR);

		return undefined;
	}
}

async function runAction(
	action: () => Promise<DeviceAuthorizationState>,
	failure: string,
): Promise<boolean> {
	const requestVersion = snapshotVersion;

	accountStore.isBusy.set(true);

	try {
		const result = await action();

		if (isLive() && requestVersion === snapshotVersion) {
			applySnapshot(result);
		}

		return true;
	} catch (error: unknown) {
		logger.error(`[activity] ${failure}`, error);

		if (isLive()) {
			showErrorToast(failure);
		}

		return false;
	} finally {
		accountStore.isBusy.set(false);
	}
}

export function startSignIn(): void {
	void runAction(startDeviceAuthorization, "Could not start sign-in.");
}

export function cancelSignIn(): void {
	void runAction(cancelDeviceAuthorization, "Could not cancel sign-in.");
}

export function signOutOfActivity(): void {
	void (async () => {
		if ((await runAction(signOutActivity, "Could not sign out.")) && isLive()) {
			showSuccessToast("Signed out of Activity on this Deck.");
		}
	})();
}

export function reloadProfile(): void {
	if (accountStore.authorization.peek()?.status === "signedIn") {
		void loadProfile(false);
	}
}

/**
 * Tracks the Activity account for the plugin's lifetime: backend events, sign-in prompts from
 * account-bound RPCs, and one prompt at mount when the first snapshot is not signed in.
 */
export function mountActivityAccount(scope: LifetimeScope): void {
	lifetime = scope;

	scope.addDisposer(onDeviceAuthorizationChanged(applySnapshot));
	scope.addDisposer(authorizationGate.onSignInRequired(promptSignIn));

	void (async () => {
		const current = await refreshActivityAccount();

		if (current !== undefined && current.status !== "signedIn") {
			promptSignIn();
		}
	})();
}
