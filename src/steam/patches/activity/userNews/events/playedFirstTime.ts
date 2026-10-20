import type { PlayedFirstTimeUserNewsEvent } from "@typings/userNews";
import { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type { UserNewsEventContext, UserNewsEventResult } from "./types";
import { UserNewsFeedEventHandler } from "./userNewsFeedEventHandler";

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
