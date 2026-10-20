export type GetFriendsGameplayInfoEntry = {
	minutes_played: number;
	minutes_played_forever: number;
	steamid: string;
};

export type GetFriendsGameplayInfoResponse = {
	in_game: GetFriendsGameplayInfoEntry[];
	in_wishlist: GetFriendsGameplayInfoEntry[];
	owns: GetFriendsGameplayInfoEntry[];
	played_ever: GetFriendsGameplayInfoEntry[];
	played_recently: GetFriendsGameplayInfoEntry[];
};
