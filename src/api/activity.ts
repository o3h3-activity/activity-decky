import { authorizationGate } from "./account";

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
 * Records a committed interval (epoch milliseconds), replacing persisted UTC daily totals at
 * `/api/v1/me/games/{gameId}/releases/{releaseId}/versions/{releaseVersionId}/playtime/days/{date}`.
 */
export const recordPlaytime = authorizationGate.guardMutation("record_playtime");
