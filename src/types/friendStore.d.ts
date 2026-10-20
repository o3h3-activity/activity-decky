export type SteamId = {
	ConvertTo64BitString(): string;
};

export type FriendPersona = {
	m_bInitialized?: unknown;
};

export type FriendState = {
	display_name?: string;
	is_friend?: boolean;
	nickname?: string;
	persona?: FriendPersona;
};

export type SteamFriendStore = {
	GetFriendState: (...args: unknown[]) => FriendState;
};

declare global {
	interface Window {
		friendStore?: SteamFriendStore;
	}
}
