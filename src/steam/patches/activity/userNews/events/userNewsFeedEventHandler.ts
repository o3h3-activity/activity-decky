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

/** Converts one feed event kind into Steam `CUserNews_Event` protos. */
export abstract class UserNewsFeedEventHandler<
	TKind extends UserNewsEvent["kind"] = UserNewsEvent["kind"],
> {
	protected abstract readonly kind: TKind;
	protected abstract readonly eventType: SteamUserNewsEventType;

	/**
	 * Selects this handler's events from the whole feed, preserving feed order.
	 * `undefined` means required conversion data is unavailable, so callers must
	 * preserve Steam's cached response rather than commit a partial replacement.
	 */
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

	/** One proto for `event` at its `rtime`, typed by this handler's `eventType`. */
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
