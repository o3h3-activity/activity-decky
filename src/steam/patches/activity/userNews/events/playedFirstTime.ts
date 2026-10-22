import type { PlayedFirstTimeUserNewsEvent } from "@typings/userNews";
import { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type { UserNewsEventContext, UserNewsEventResult } from "./types";
import { UserNewsFeedEventHandler } from "./userNewsFeedEventHandler";

/**
 * Maps first-play records to Steam's `PlayedGameFirstTime` event.
 *
 * No extra payload is needed beyond the shared author, game ID, and time.
 * Steam uses that time both for display and as the comment-thread feature ID,
 * so the normalized feed timestamp is kept unchanged.
 */
export class PlayedFirstTimeUserNewsEventHandler extends UserNewsFeedEventHandler<"played_first_time"> {
	protected readonly kind = "played_first_time";
	protected readonly eventType = SteamUserNewsEventType.PlayedFirstTime;

	protected create(
		events: readonly PlayedFirstTimeUserNewsEvent[],
		context: UserNewsEventContext,
	): UserNewsEventResult[] {
		return events.map((event) => this.toResult(event, context));
	}
}
