import type { AchievementsProvider } from "@steam/achievements/achievementsProvider";
import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import type { ShortcutClanRegistry } from "../shortcuts/clanIdentity";
import { SteamFriendsGameplayPatcher } from "./friendsGameplay";
import { SteamUserNewsPatcher } from "./userNews";
import { UserStatusPatcher } from "./userStatus";
import { VirtualFriendPatcher } from "./virtualFriends";

/**
 * Shares friend and status state between the Activity-tab patches.
 *
 * Steam looks up each event or gameplay row's author through `GetFriendState`.
 * Both feeds therefore need the same `VirtualFriendPatcher`. User News also
 * needs the same `UserStatusPatcher` that answers the later status-text lookup.
 * Keeping them in one scope removes the feeds and their supporting state
 * together on logout.
 */
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
