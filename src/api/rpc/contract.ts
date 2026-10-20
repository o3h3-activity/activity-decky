import type { ActivityUser } from "../account";
import type { GameRecognitionResult } from "../catalog";
import type { GameIdentityRequest, GameIdentityResult } from "../discIdentity";
import type { ApiResult } from "./result";

/** Safe to abandon at a deadline: repeating it changes nothing the user can see. */
type Query<Args extends unknown[], Result> = Readonly<{
	args: Args;
	effect: "query";
	result: Result;
}>;

/** Changes backend or Activity state; Decky cannot cancel it once dispatched, so it is never abandoned. */
type Mutation<Args extends unknown[], Result> = Readonly<{
	args: Args;
	effect: "mutation";
	result: Result;
}>;

/**
 * Mirrors the public `Plugin` methods in main.py: one row per Decky RPC, keyed by its wire name.
 * `unknown` results are untrusted and validated by the owning API module.
 */
export type RpcContract = {
	cancel_device_authorization: Mutation<[], unknown>;
	delete_comment: Mutation<
		[
			gameId: string,
			releaseId: string,
			releaseRevisionId: string,
			commentId: string,
		],
		ApiResult
	>;
	game_anatomy_handshake: Query<[], boolean>;
	get_activity: Query<
		[gameId: string, releaseId: string, releaseRevisionId: string],
		ApiResult
	>;
	get_activity_user: Query<[], ActivityUser | null>;
	get_debug_enabled: Query<[], boolean | null>;
	get_device_authorization: Query<[], unknown>;
	get_friends_gameplay: Query<
		[gameId: string, releaseId: string, releaseRevisionId: string],
		ApiResult
	>;
	get_game_identities: Query<
		[games: GameIdentityRequest[]],
		GameIdentityResult[]
	>;
	get_retro_achievements: Query<[romPath: string], unknown>;
	post_comment: Mutation<
		[
			gameId: string,
			releaseId: string,
			releaseRevisionId: string,
			body: string,
		],
		ApiResult
	>;
	recognize_games: Query<
		[identities: GameIdentityResult[]],
		GameRecognitionResult[]
	>;
	record_playtime: Mutation<
		[
			gameId: string,
			releaseId: string,
			releaseRevisionId: string,
			startedAt: number,
			endedAt: number,
		],
		ApiResult
	>;
	set_debug_enabled: Mutation<[enabled: boolean], void>;
	sign_out_activity: Mutation<[], unknown>;
	start_device_authorization: Mutation<[], unknown>;
};

export type RpcName = keyof RpcContract;
export type RpcArgs<N extends RpcName> = RpcContract[N]["args"];
export type RpcResult<N extends RpcName> = RpcContract[N]["result"];
export type RpcCall<N extends RpcName> = (
	...args: RpcArgs<N>
) => Promise<RpcResult<N>>;

export type QueryRpcName = {
	[N in RpcName]: RpcContract[N]["effect"] extends "query" ? N : never;
}[RpcName];

export type MutationRpcName = Exclude<RpcName, QueryRpcName>;

/** RPCs answering with the `ApiResult` envelope. */
export type ApiResultRpcName = {
	[N in RpcName]: RpcResult<N> extends ApiResult ? N : never;
}[RpcName];
