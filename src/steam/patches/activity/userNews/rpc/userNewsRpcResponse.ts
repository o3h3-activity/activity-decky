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

export abstract class UserNewsRpcResponse {
	/** Keeps results inside the request window, newest first, capped at `request.count`; equal times keep input order. */
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
