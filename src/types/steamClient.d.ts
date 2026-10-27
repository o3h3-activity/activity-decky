import type { SteamClient as SteamClientApi } from "@decky/ui/dist/globals/steam-client";

declare global {
	const SteamClient: SteamClientApi;
}
