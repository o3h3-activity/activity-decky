import type { ActivityUser } from "@api/account";
import { isNil } from "es-toolkit";

type SignedInProfile = null | Pick<ActivityUser, "nickname"> | undefined;

export const SIGNED_OUT_HINT =
	"Sign in to use Activity’s features on this Deck.";

export const SIGNED_IN_LABEL = "Signed in to Activity";

function signedInAccount(profile: SignedInProfile): string {
	if (isNil(profile)) {
		return "to Activity";
	}

	return `as ${profile.nickname}`;
}

export function signedInToast(profile: SignedInProfile): string {
	return `Signed in ${signedInAccount(profile)}.`;
}

export function signedInPageMessage(
	profile: SignedInProfile,
	hasWitnessedSignIn: boolean,
): string {
	const account = signedInAccount(profile);

	if (hasWitnessedSignIn) {
		return `You’re signed in ${account}.`;
	}

	return `You’re already signed in ${account}.`;
}
