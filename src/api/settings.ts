import { mutationRpc, rpc } from "./rpc/transport";

export const getIsDebugEnabled = rpc("get_debug_enabled");

export const setIsDebugEnabled = mutationRpc("set_debug_enabled");
