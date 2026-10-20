import type { ReceivedNewGameUserNewsEvent } from "@typings/userNews";
import { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type { UserNewsEventContext, UserNewsEventResult } from "./types";
import { UserNewsFeedEventHandler } from "./userNewsFeedEventHandler";

export class ReceivedNewGameUserNewsEventHandler extends UserNewsFeedEventHandler<"received_new_game"> {
	protected readonly kind = "received_new_game";
	protected readonly eventType = SteamUserNewsEventType.ReceivedNewGame;

	protected create(
		events: readonly ReceivedNewGameUserNewsEvent[],
		context: UserNewsEventContext,
	): UserNewsEventResult[] {
		return events.map((event) =>
			this.toResult(event, context, { appids: [context.appId] }),
		);
	}
}
