import type { Events } from "@events";
import { userStory } from "@stores/user";
import type { Emitter } from "nanoevents";

export class UserStateManager {
	private readonly unmountHandlers: Array<() => void>;

	constructor(eventBus: Emitter<Events>) {
		this.unmountHandlers = [
			eventBus.on("UserLoggedIn", () => {
				userStory.isLoggedIn.set(true);
			}),
			eventBus.on("UserLoggedOut", () => {
				userStory.isLoggedIn.set(false);
			}),
		];
	}

	public unMount(): void {
		this.unmountHandlers.forEach((unmount) => {
			unmount();
		});
	}
}
