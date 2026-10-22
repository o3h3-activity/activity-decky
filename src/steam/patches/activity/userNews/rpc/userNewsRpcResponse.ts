import {
	createSteamRpcResponse,
	type RpcResponse,
} from "@steam/patches/rpcResponse";
import type { SteamUserNewsProtoEvent } from "@typings/userNewsService";
import type { UserNewsEventResult, UserNewsRequest } from "../events/types";
import { UserNewsRequests } from "./userNewsRequests";

export type GetUserNewsRpcResponse = RpcResponse<{
	achievement_display_data: () => [];
	news: () => SteamUserNewsProtoEvent[];
}>;

export type GetAppDetailsSpotlightRpcResponse = RpcResponse<{
	events: () => [];
	toObject: () => { events: [] };
}>;

/**
 * Wraps converted events in the RPC response Steam expects.
 *
 * Steam calls `Body().news()` and `Body().achievement_display_data()`, so
 * these must be methods, not plain JSON fields. The display-data list is
 * empty because the achievement handler has already filled Steam's in-memory
 * achievement map.
 *
 * News is filtered to the request window, sorted newest first, and capped
 * at the requested count. Events with equal timestamps keep their input
 * order. `emptySpotlight` supplies both `events()` and `toObject()` for the
 * separate spotlight request.
 */
export abstract class UserNewsRpcResponse {
	public static fromEventResults(
		results: readonly UserNewsEventResult[],
		request: UserNewsRequest,
	): GetUserNewsRpcResponse {
		const events = results
			.filter(({ eventTime }) =>
				UserNewsRequests.isWithinWindow(request, eventTime),
			)
			.sort((left, right) => right.eventTime - left.eventTime)
			.slice(0, request.count)
			.map(({ event }) => event);

		return createSteamRpcResponse(() => ({
			achievement_display_data: () => [],
			news: () => events,
		}));
	}

	public static emptySpotlight(): GetAppDetailsSpotlightRpcResponse {
		return createSteamRpcResponse(() => ({
			events: () => [],
			toObject: () => ({ events: [] }),
		}));
	}
}
