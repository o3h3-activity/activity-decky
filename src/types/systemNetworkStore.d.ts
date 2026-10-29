import type { ConnectivityTest } from "@decky/ui/dist/globals/steam-client/system/network";

/** Steam's network store (`SystemNetworkStore` in sp.js), which backs the Gamepad UI network status. */
export type SteamSystemNetworkStore = {
	/** Latest `System.Network.RegisterForConnectivityTestChanges` result Steam received. */
	readonly connectivityTestState: ConnectivityTest;
	/** Steam's CM connection; the getter throws until Steam has initialised the store. */
	readonly hasSteamConnection: boolean;
};

declare global {
	interface Window {
		SystemNetworkStore?: SteamSystemNetworkStore;
	}
}
