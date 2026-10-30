import { accountStore } from "@stores/account";
import { isPlayTimeSharingActive } from "@stores/playTimeSync";

/**
 * The profile Steam ID is not available during the initial account load. Until it is known, the
 * backend remains the authority for the account check; once known, never collect or upload for a
 * different Steam login.
 */
export function canSharePlayTime(steamId: string): boolean {
	if (!isPlayTimeSharingActive.peek()) {
		return false;
	}

	const linkedSteamId = accountStore.profile.peek()?.steamId;

	return (
		linkedSteamId === undefined ||
		linkedSteamId === null ||
		linkedSteamId === steamId
	);
}
