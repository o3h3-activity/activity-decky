import { getAccountId } from "@steam/patches/activity/steamId";
import type { UserStatusPatcher } from "@steam/patches/activity/userStatus";
import type { UserStatusUserNewsEvent } from "@typings/userNews";
import { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type { UserNewsEventContext, UserNewsEventResult } from "./types";
import { feedEventActorSteamId } from "./userNewsEventResult";
import { UserNewsFeedEventHandler } from "./userNewsFeedEventHandler";

/**
 * Creates a Steam status event for an Activity comment.
 *
 * Steam does not read the comment text from the event. `AddUserStatus` makes
 * a second request using the author's SteamID and event timestamp as the
 * post ID. We register the comment with `UserStatusPatcher` before returning
 * the event, so that lookup can supply its text and later resolve deletions.
 */
export class UserStatusUserNewsEventHandler extends UserNewsFeedEventHandler<"user_status"> {
	protected readonly kind = "user_status";
	protected readonly eventType = SteamUserNewsEventType.UserStatus;

	constructor(private readonly userStatus: UserStatusPatcher) {
		super();
	}

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
