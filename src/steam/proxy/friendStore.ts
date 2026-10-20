import type { SteamFriendStore } from "@typings/friendStore";

export class FriendStore {
	public static getFriendStore(): Nullable<SteamFriendStore> {
		return window.friendStore;
	}
}
