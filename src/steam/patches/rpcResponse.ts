import { EResult } from "@decky/ui/dist/globals/steam-client/shared";

export type RpcResponse<TBody> = {
	Body: () => TBody;
	GetEResult: () => EResult;
};

/**
 * Supplies the Body()/GetEResult() envelope Steam RPC consumers expect without
 * duplicating it across patches. The callback preserves each response's body
 * construction behavior; extra methods such as Hdr() and BSuccess() stay local.
 */
export function createSteamRpcResponse<TBody>(
	body: () => TBody,
	result: EResult = EResult.OK,
): RpcResponse<TBody> {
	return {
		Body: body,
		GetEResult: () => result,
	};
}
