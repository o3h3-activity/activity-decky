import { authorizationGate } from "./account";

/**
 * Catalog identity of one disc image. A 404 produces null IDs (cached by the backend for 24 hours).
 * Successful responses contain all three IDs; incomplete entries from older caches expire after
 * 24 hours so they can be resolved again.
 */
export type GameRecognitionResult = {
	gameId: null | string;
	gameIdentityMd5: string;
	releaseId: null | string;
	releaseRevisionId: null | string;
};

/**
 * Identities missing from the result are unresolved for now: signed out, rate-limited, unreachable,
 * a malformed or failed recognition response, or media without a usable serial.
 */
export const recognizeGames = authorizationGate.guard(
	"recognize_games",
	() => [],
);
