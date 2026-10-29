import {
	type ConnectivityTest,
	EConnectivityTestResult,
} from "@decky/ui/dist/globals/steam-client/system/network";
import { isNil } from "es-toolkit";

/** A verdict only once Steam's connectivity probe has finished; `undefined` while untested or running. */
function probeVerdict(test: ConnectivityTest): boolean | undefined {
	if (
		test.bChecking ||
		test.eConnectivityTestResult === EConnectivityTestResult.Unknown
	) {
		return undefined;
	}

	return test.eConnectivityTestResult === EConnectivityTestResult.Connected;
}

export class Network {
	/**
	 * Steam's own answer, as `SystemNetworkStore.hasInternetConnection` computes it: online while
	 * connected to Steam's servers or once the connectivity probe reached the Internet; offline on a
	 * captive portal, timeout, failure, disabled Wi-Fi, or no LAN. `undefined` without a verdict
	 * (probe not run yet, or no store), which callers must not treat as offline.
	 */
	public static isOnline(): boolean | undefined {
		const store = window.SystemNetworkStore;

		if (isNil(store)) {
			return undefined;
		}

		try {
			if (store.hasSteamConnection) {
				return true;
			}
		} catch {
			return undefined;
		}

		return probeVerdict(store.connectivityTestState);
	}

	/**
	 * Calls `callback` each time Steam's connectivity probe reports Internet access regained.
	 * Falls back to the browser `online` event (link up only) where the probe is unavailable.
	 * Returns the unsubscribe.
	 */
	public static onReconnected(callback: () => void): () => void {
		const network =
			typeof SteamClient === "undefined"
				? undefined
				: SteamClient.System?.Network;

		if (typeof network?.RegisterForConnectivityTestChanges !== "function") {
			window.addEventListener("online", callback);

			return () => {
				window.removeEventListener("online", callback);
			};
		}

		let connected = Network.isOnline();
		const registration = network.RegisterForConnectivityTestChanges((test) => {
			const verdict = probeVerdict(test);

			if (verdict === undefined) {
				return;
			}

			const wasConnected = connected;

			connected = verdict;

			if (verdict && wasConnected !== true) {
				callback();
			}
		});

		return () => {
			registration.unregister();
		};
	}
}
