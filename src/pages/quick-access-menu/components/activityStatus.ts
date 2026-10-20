import type { DeviceAuthorizationState } from "@api/account";

export type StatusRow = Readonly<{ description?: string; value: string }>;

export function retroAchievementsRow(
	authorization: DeviceAuthorizationState | undefined,
	loadError: string | undefined,
): StatusRow {
	if (authorization === undefined) {
		if (loadError !== undefined) {
			return {
				description: "Couldn’t load your Activity account status.",
				value: "Unavailable",
			};
		}

		return {
			description: "Checking your Activity account.",
			value: "Checking…",
		};
	}

	if (authorization.status !== "signedIn") {
		return { description: "Sign in to Activity first.", value: "Not linked" };
	}

	if (authorization.retroAchievementsLinked) {
		return { value: "Linked" };
	}

	return {
		description:
			"Link RetroAchievements to your Activity account, then sign in again on this Deck.",
		value: "Not linked",
	};
}
