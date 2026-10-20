import { getAccountId } from "@steam/patches/activity/steamId";
import type { UserStatusPatcher } from "@steam/patches/activity/userStatus";
import type { UserStatusUserNewsEvent } from "@typings/userNews";
import { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type { UserNewsEventContext, UserNewsEventResult } from "./types";
import { feedEventActorSteamId } from "./userNewsEventResult";
import { UserNewsFeedEventHandler } from "./userNewsFeedEventHandler";

export class UserStatusUserNewsEventHandler extends UserNewsFeedEventHandler<"user_status"> {
	protected readonly kind = "user_status";
	protected readonly eventType = SteamUserNewsEventType.UserStatus;

	constructor(private readonly userStatus: UserStatusPatcher) {
		super();
	}

	/**
	 * Converts API statuses to Steam news events and registers their secondary lookup data.
	 */
	protected create(
		events: readonly UserStatusUserNewsEvent[],
		context: UserNewsEventContext,
	): UserNewsEventResult[] {
		return events.map((event) => {
			const steamId = feedEventActorSteamId(event);

			this.userStatus.register({
				accountId: getAccountId(BigInt(steamId)),
				appId: context.appId,
				commentId: event.id,
				ownedByCurrentUser: event.ownedByCurrentUser,
				postId: event.rtime.toString(),
				statusText: event.status_text,
				steamId,
			});

			return this.toResult(event, context);
		});
	}
}
