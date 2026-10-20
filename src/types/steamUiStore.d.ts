export type SteamNavigator = {
	SteamWeb: (...args: unknown[]) => unknown;
};

export type SteamUIWindow = {
	Navigator?: unknown;
	SetNavigator: (navigator: unknown) => void;
};

export type SteamUIWindowStore = {
	SteamUIWindows?: unknown;
};

export type SteamUIStore = {
	WindowStore?: SteamUIWindowStore;
};
