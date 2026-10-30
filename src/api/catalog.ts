import { authorizationGate } from "./account";
import { RPC_TIMEOUT_MS } from "./rpc/transport";

/** Most identities sent per `recognizeGameBatch` call. */
export const RECOGNITION_BATCH_SIZE = 256;

/** The backend's HTTP timeout; it asks Activity about each uncached identity in turn. */
const BACKEND_REQUEST_TIMEOUT_MS = 10_000;

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

/**
 * `recognizeGames` for up to `RECOGNITION_BATCH_SIZE` identities: a full batch of uncached identities
 * can legitimately take one backend request timeout each, far beyond the default deadline.
 */
export const recognizeGameBatch = authorizationGate.guard(
	"recognize_games",
	() => [],
	RECOGNITION_BATCH_SIZE * BACKEND_REQUEST_TIMEOUT_MS + RPC_TIMEOUT_MS,
);
