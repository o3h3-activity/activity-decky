import type { ReceivedNewGameUserNewsEvent } from "@typings/userNews";
import { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type { UserNewsEventContext, UserNewsEventResult } from "./types";
import { UserNewsFeedEventHandler } from "./userNewsFeedEventHandler";

/**
 * Adds the shortcut to a Steam `ReceivedNewGame` event.
 *
 * Steam groups received games by author. `AddReceivedGames` reads the
 * event's `appids` list before considering its fallback app ID, so we
 * explicitly supply the current shortcut. This creates a feed entry only;
 * it does not change Steam licenses or ownership.
 */
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
