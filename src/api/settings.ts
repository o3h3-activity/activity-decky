import { mutationRpc, rpc } from "./rpc/transport";

export const getIsDebugEnabled = rpc("get_debug_enabled");

export const setIsDebugEnabled = mutationRpc("set_debug_enabled");

/** Whether PlayTime intervals may be sent to Activity; `false` until the user opts in. */
export const getIsPlayTimeSyncEnabled = rpc("get_play_time_sync_enabled");

export const setIsPlayTimeSyncEnabled = mutationRpc(
	"set_play_time_sync_enabled",
);
