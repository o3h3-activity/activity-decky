import type { UserNewsEventBase } from "@typings/userNews";
import type { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type { UserNewsEventContext, UserNewsEventResult } from "./types";

/** Kind-specific `CUserNews_Event` fields, e.g. `appids`. */
export type UserNewsProtoFields = Readonly<Record<string, unknown>>;

export type UserNewsEventResultInit = Readonly<{
	actorSteamId: string;
	eventTime: number;
	eventType: SteamUserNewsEventType;
	fields?: UserNewsProtoFields;
}>;

/** Builds one `CUserNews_Event` for the context's app; common fields override `fields`. */
export function createUserNewsEventResult(
	context: UserNewsEventContext,
	{ actorSteamId, eventTime, eventType, fields }: UserNewsEventResultInit,
): UserNewsEventResult {
	return {
		event: context.proto.fromObject({
			...fields,
			eventtime: eventTime,
			eventtype: eventType,
			gameid: context.gameId,
			steamid_actor: actorSteamId,
		}),
		eventTime,
	};
}

/** Feed events are always attributed to their Activity actor. */
export function feedEventActorSteamId(event: UserNewsEventBase): string {
	return event.actor.steamId;
}
