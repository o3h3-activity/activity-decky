import type { UserNewsEvent } from "@typings/userNews";
import type { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type { UserNewsEventContext, UserNewsEventResult } from "./types";
import {
	createUserNewsEventResult,
	feedEventActorSteamId,
	type UserNewsProtoFields,
} from "./userNewsEventResult";

export type UserNewsEventOfKind<TKind extends UserNewsEvent["kind"]> = Extract<
	UserNewsEvent,
	{ kind: TKind }
>;

/**
 * Converts one Activity event kind into Steam UserNews events.
 *
 * Steam chooses the event renderer from `eventtype()`. Each handler selects
 * that type and supplies any extra fields, while the shared result builder
 * adds the author, timestamp, and game ID.
 *
 * An empty array is a successful result with nothing to add. `undefined`
 * means conversion could not finish, so the caller must use Steam's response
 * instead of replacing the feed with only the events that converted.
 */
export abstract class UserNewsFeedEventHandler<
	TKind extends UserNewsEvent["kind"] = UserNewsEvent["kind"],
> {
	protected abstract readonly kind: TKind;
	protected abstract readonly eventType: SteamUserNewsEventType;

	public createFromFeed(
		events: readonly UserNewsEvent[],
		context: UserNewsEventContext,
	): Promise<undefined | UserNewsEventResult[]> {
		return Promise.resolve(
			this.create(
				events.filter(
					(event): event is UserNewsEventOfKind<TKind> =>
						event.kind === this.kind,
				),
				context,
			),
		);
	}

	protected abstract create(
		events: readonly UserNewsEventOfKind<TKind>[],
		context: UserNewsEventContext,
	):
		| Promise<undefined | UserNewsEventResult[]>
		| undefined
		| UserNewsEventResult[];

	protected toResult(
		event: UserNewsEventOfKind<TKind>,
		context: UserNewsEventContext,
		fields?: UserNewsProtoFields,
	): UserNewsEventResult {
		return createUserNewsEventResult(context, {
			actorSteamId: feedEventActorSteamId(event),
			eventTime: event.rtime,
			eventType: this.eventType,
			fields,
		});
	}
}
