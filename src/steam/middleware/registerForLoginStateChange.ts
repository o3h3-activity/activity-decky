import { ELoginState } from "@decky/ui/dist/globals/steam-client/User";
import type { Events } from "@events";
import logger from "@utils/logger";
import type { Emitter } from "nanoevents";

export class RegisterForLoginStateChange {
	private static activeHooks: Array<Unregisterable> = [];

	private static registerForLoginStateChange(
		eventBus: Emitter<Events>,
	): Unregisterable {
		return SteamClient.User.RegisterForLoginStateChange(
			(username: string, state: ELoginState, ...rest) => {
				logger.debug(
					`RegisterForLoginStateChange -> ${username} | ${state}`,
					rest,
				);

				if (state === ELoginState.Success) {
					eventBus.emit("UserLoggedIn", username);

					return;
				}

				if (state === ELoginState.Quit) {
					eventBus.emit("UserLoggedOut");
				}
			},
		);
	}

	public static register(eventBus: Emitter<Events>): void {
		RegisterForLoginStateChange.activeHooks.push(
			RegisterForLoginStateChange.registerForLoginStateChange(eventBus),
		);
	}

	public static unregister(): void {
		for (const hook of RegisterForLoginStateChange.activeHooks) {
			hook.unregister();
		}

		RegisterForLoginStateChange.activeHooks = [];
	}
}
