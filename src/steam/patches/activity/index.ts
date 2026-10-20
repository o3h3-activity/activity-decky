import type { AchievementsProvider } from "@steam/achievements/achievementsProvider";
import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import type { ShortcutClanRegistry } from "../shortcuts/clanIdentity";
import { SteamFriendsGameplayPatcher } from "./friendsGameplay";
import { SteamUserNewsPatcher } from "./userNews";
import { UserStatusPatcher } from "./userStatus";
import { VirtualFriendPatcher } from "./virtualFriends";

export class SteamActivityTabPatcher {
	private readonly scope = new LifetimeScope("Activity");

	constructor(
		provider: AchievementsProvider,
		shortcutClans: ShortcutClanRegistry,
		games: Games,
	) {
		const virtualFriends = this.scope.track(new VirtualFriendPatcher());
		const userStatus = this.scope.track(new UserStatusPatcher(games));

		this.scope.track(
			new SteamUserNewsPatcher(provider, shortcutClans, {
				games,
				userStatus,
				virtualFriendPatcher: virtualFriends,
			}),
		);

		this.scope.track(
			new SteamFriendsGameplayPatcher({
				games,
				virtualFriendPatcher: virtualFriends,
			}),
		);
	}

	public unMount(): void {
		this.scope.unMount();
	}
}
