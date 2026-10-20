import { addEventListener, removeEventListener } from "@decky/api";
import { isObjectLike } from "@utils/isObjectLike";
import logger from "@utils/logger";
import { AuthorizationGate, type Unsubscribe } from "./rpc/authorizationGate";
import type { RpcName } from "./rpc/contract";
import { mutationRpc, rpc } from "./rpc/transport";

const DEVICE_AUTHORIZATION_STATUSES = [
	"denied",
	"error",
	"expired",
	"pending",
	"signedIn",
	"signedOut",
	"starting",
] as const;

export type DeviceAuthorizationStatus =
	(typeof DEVICE_AUTHORIZATION_STATUSES)[number];

export type DeviceAuthorizationState = {
	accessTokensUrl: string;
	/** Wall-clock epoch milliseconds when the pending sign-in code expires, or 0 without one. */
	codeExpiresAt: number;
	message: string;
	/** The signed-in session carries RetroAchievements credentials; the credentials stay in the backend. */
	retroAchievementsLinked: boolean;
	status: DeviceAuthorizationStatus;
	tokenExpiresAt: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
};

export type ActivityUser = {
	avatarUrl: null | string;
	nickname: string;
	/** Decimal SteamID64 linked to the Activity account; null until production returns it. */
	steamId: null | string;
};

/** Mirrors `DEVICE_AUTHORIZATION_EVENT` in py_modules/activity_backend/modules/authorization/adapters/decky_emitter.py. */
const DEVICE_AUTHORIZATION_EVENT = "device_authorization_changed";

const STATUSES: ReadonlySet<unknown> = new Set(DEVICE_AUTHORIZATION_STATUSES);
const STRING_FIELDS = [
	"accessTokensUrl",
	"message",
	"tokenExpiresAt",
	"userCode",
	"verificationUri",
	"verificationUriComplete",
] as const satisfies readonly (keyof DeviceAuthorizationState)[];

function isDeviceAuthorizationState(
	value: unknown,
): value is DeviceAuthorizationState {
	if (!isObjectLike(value)) {
		return false;
	}

	const candidate = value as Partial<Record<string, unknown>>;

	return (
		STATUSES.has(candidate.status) &&
		typeof candidate.codeExpiresAt === "number" &&
		typeof candidate.retroAchievementsLinked === "boolean" &&
		STRING_FIELDS.every((field) => typeof candidate[field] === "string")
	);
}

/** Rejects a malformed backend snapshot, so callers handle it like any failed RPC. Only the read has a deadline. */
function authorizationRpc(
	name: Extract<
		RpcName,
		| "cancel_device_authorization"
		| "get_device_authorization"
		| "sign_out_activity"
		| "start_device_authorization"
	>,
): () => Promise<DeviceAuthorizationState> {
	const request =
		name === "get_device_authorization" ? rpc(name) : mutationRpc(name);

	return async () => {
		const state = await request();

		if (!isDeviceAuthorizationState(state)) {
			throw new TypeError(`Malformed device authorization state from ${name}`);
		}

		return state;
	};
}

export const getDeviceAuthorization = authorizationRpc(
	"get_device_authorization",
);

export const startDeviceAuthorization = authorizationRpc(
	"start_device_authorization",
);

export const cancelDeviceAuthorization = authorizationRpc(
	"cancel_device_authorization",
);

export const signOutActivity = authorizationRpc("sign_out_activity");

/** Forwards each valid backend snapshot; malformed events are logged and dropped. */
export function onDeviceAuthorizationChanged(
	listener: (state: DeviceAuthorizationState) => void,
): Unsubscribe {
	const handler = addEventListener<[unknown]>(
		DEVICE_AUTHORIZATION_EVENT,
		(state) => {
			if (isDeviceAuthorizationState(state)) {
				listener(state);

				return;
			}

			logger.error(
				"[activity] Dropped malformed device authorization event",
				state,
			);
		},
	);

	return () => {
		removeEventListener(DEVICE_AUTHORIZATION_EVENT, handler);
	};
}

/** Guards every Activity-account RPC; subscribe `onSignInRequired` to surface sign-in prompts. */
export const authorizationGate = new AuthorizationGate(async () => {
	const state = await getDeviceAuthorization();

	return state.status === "signedIn";
});

export const getActivityUser = authorizationGate.guard(
	"get_activity_user",
	// oxlint-disable-next-line unicorn/no-null -- Preserve the RPC's nullable user contract.
	() => null,
);
