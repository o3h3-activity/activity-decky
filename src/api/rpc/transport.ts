import { callable } from "@decky/api";
import { timeout } from "es-toolkit";
import type {
	MutationRpcName,
	QueryRpcName,
	RpcArgs,
	RpcCall,
	RpcName,
	RpcResult,
} from "./contract";

/** Three times the backend's 10 s HTTP timeout: only a stuck Decky bridge or backend handler reaches it. */
export const RPC_TIMEOUT_MS = 30_000;

/**
 * Settles with `task`, or rejects with es-toolkit's `TimeoutError` once `timeoutMs` has passed.
 * Nothing is cancelled: `expired` aborts at the deadline so `task` can skip work its caller abandoned.
 */
export async function withDeadline<T>(
	task: (expired: AbortSignal) => Promise<T>,
	timeoutMs = RPC_TIMEOUT_MS,
): Promise<T> {
	const expiry = new AbortController();
	// Aborting after settlement clears the deadline timer.
	const settled = new AbortController();
	const deadline = (async (): Promise<never> => {
		try {
			return await timeout(timeoutMs, { signal: settled.signal });
		} catch (error: unknown) {
			expiry.abort(error);

			throw error;
		}
	})();

	try {
		return await Promise.race([task(expiry.signal), deadline]);
	} finally {
		settled.abort();
	}
}

/** Decky callable without a deadline; the caller owns the deadline policy. */
export function untimedRpc<N extends RpcName>(name: N): RpcCall<N> {
	return callable<RpcArgs<N>, RpcResult<N>>(name);
}

/** Query callable; rejects with `TimeoutError` when the backend has not answered after `timeoutMs`. */
export function rpc<N extends QueryRpcName>(
	name: N,
	timeoutMs = RPC_TIMEOUT_MS,
): RpcCall<N> {
	const call = untimedRpc(name);

	return async (...args) => withDeadline(async () => call(...args), timeoutMs);
}

/**
 * Mutation callable, deliberately without a deadline: Decky cannot cancel a dispatched call, so a
 * write abandoned as failed could still commit, and the user's retry would then apply it twice.
 */
export function mutationRpc<N extends MutationRpcName>(name: N): RpcCall<N> {
	return untimedRpc(name);
}
