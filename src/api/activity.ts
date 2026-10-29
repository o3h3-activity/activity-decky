import { authorizationGate } from "./account";
import { mutationRpc, rpc } from "./rpc/transport";

/** A durable committed interval; resolved identifiers are pinned before the first upload. */
export type PendingPlaytime = Readonly<{
	appId: number;
	endedAt: number;
	gameId?: string;
	releaseId?: string;
	releaseRevisionId?: string;
	startedAt: number;
}>;

/** Persists locally without contacting Activity or resolving the game. */
export const enqueuePlaytime = mutationRpc("enqueue_playtime");

/** Reads only the current Steam account's durable outbox. */
export const getPendingPlaytime = rpc("get_pending_playtime");

/** Gets `ActivityResponse` comments and achievements from `/api/v1/activity` for the catalog game, release, and version. */
export const getActivity = authorizationGate.guardResult("get_activity");

/**
 * Gets friends' recorded gameplay from
 * `/api/v1/games/{gameId}/releases/{releaseId}/versions/{releaseVersionId}/friends`;
 * `data` is a `FriendPlaytimeResponse[]`.
 */
export const getFriendsGameplay = authorizationGate.guardResult(
	"get_friends_gameplay",
);

/**
 * Posts a `steam-bbcode` JSON comment to
 * `/api/v1/games/{gameId}/releases/{releaseId}/versions/{releaseVersionId}/comments`;
 * `data` is the created `CommentResponse`.
 */
export const postComment = authorizationGate.guardMutation("post_comment");

/**
 * Deletes through
 * `/api/v1/games/{gameId}/releases/{releaseId}/versions/{releaseVersionId}/comments/{commentId}`;
 * `data` is null on success.
 */
export const deleteComment = authorizationGate.guardMutation("delete_comment");

/**
 * Uploads a queued interval for the matching Steam account, replacing persisted UTC daily totals.
 * The backend acknowledges the interval only after every affected day succeeds.
 */
export const recordPlaytime =
	authorizationGate.guardMutation("record_playtime");
