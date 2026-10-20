import logger from "@utils/logger";
import type {
	ApiResultRpcName,
	MutationRpcName,
	QueryRpcName,
	RpcArgs,
	RpcCall,
	RpcName,
	RpcResult,
} from "./contract";
import { type ApiResult, apiFailure, isSignInError } from "./result";
import { untimedRpc, withDeadline } from "./transport";

export type SignInListener = () => void;
export type Unsubscribe = () => void;

export type ApiResultCall<N extends ApiResultRpcName> = (
	...args: RpcArgs<N>
) => Promise<ApiResult>;

/**
 * Dispatches account-bound RPCs only while signed in, and tells listeners whenever the user must sign in.
 * The Python clients guard the HTTP boundary too; this gate saves the round trip and owns the prompt trigger.
 * Queries get one deadline spanning the authorization check and the request; mutations bound only the check.
 */
export class AuthorizationGate {
	private readonly listeners = new Set<SignInListener>();
	private preflight: Promise<boolean> | undefined;

	constructor(private readonly readIsSignedIn: () => Promise<boolean>) {}

	onSignInRequired(listener: SignInListener): Unsubscribe {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Signed out: `signedOut()` without dispatch. Preflight failures, transport failures and the deadline reject. */
	guard<N extends QueryRpcName>(
		name: N,
		signedOut: () => RpcResult<N>,
	): RpcCall<N> {
		const request = untimedRpc(name);

		return async (...args) =>
			withDeadline(async (expired) => {
				const signedIn = await this.isSignedIn();

				// The caller already gave up: neither dispatch nor prompt.
				expired.throwIfAborted();

				if (signedIn) {
					return request(...args);
				}

				this.requestSignIn();

				return signedOut();
			});
	}

	/** Never rejects: preflight, transport and deadline failures resolve `unreachable`. */
	guardResult<N extends ApiResultRpcName & QueryRpcName>(
		name: N,
	): ApiResultCall<N> {
		const request: ApiResultCall<N> = untimedRpc(name);

		return async (...args) =>
			this.settle(name, async () =>
				withDeadline(async (expired) => {
					const signedIn = await this.isSignedIn();

					expired.throwIfAborted();

					return signedIn ? request(...args) : apiFailure("notSignedIn");
				}),
			);
	}

	/**
	 * Never rejects: preflight and transport failures resolve `unreachable`. Once dispatched, the mutation is
	 * awaited without a deadline, so its result never contradicts what the backend committed.
	 */
	guardMutation<N extends ApiResultRpcName & MutationRpcName>(
		name: N,
	): ApiResultCall<N> {
		const request: ApiResultCall<N> = untimedRpc(name);

		return async (...args) =>
			this.settle(name, async () =>
				(await withDeadline(async () => this.isSignedIn()))
					? request(...args)
					: apiFailure("notSignedIn"),
			);
	}

	private async settle(
		name: RpcName,
		attempt: () => Promise<ApiResult>,
	): Promise<ApiResult> {
		let result: ApiResult;

		try {
			result = await attempt();
		} catch (error: unknown) {
			logger.error(`[api] ${name} failed`, error);

			return apiFailure("unreachable");
		}

		if (!result.ok && isSignInError(result.error)) {
			this.requestSignIn();
		}

		return result;
	}

	/** Concurrent callers share one check; a settled one is never reused, as the backend expires tokens without an event. */
	private async isSignedIn(): Promise<boolean> {
		this.preflight ??= this.checkSignedInOnce();

		return this.preflight;
	}

	private async checkSignedInOnce(): Promise<boolean> {
		try {
			return await this.readIsSignedIn();
		} finally {
			this.preflight = undefined;
		}
	}

	private requestSignIn(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
