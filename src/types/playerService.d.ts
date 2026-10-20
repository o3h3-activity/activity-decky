/** Steam's `Player` protobuf service namespace; lists only the RPCs the plugin patches. */
export type SteamPlayerService = {
	DeletePostedStatus: (...args: unknown[]) => unknown;
	GetFriendsGameplayInfo: (...args: unknown[]) => unknown;
	GetPostedStatus: (...args: unknown[]) => unknown;
	PostStatusToFriends: (...args: unknown[]) => unknown;
};
