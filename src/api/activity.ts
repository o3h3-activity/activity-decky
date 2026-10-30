import type { components } from "../../steam-deck-api";
import { authorizationGate } from "./account";
import { mutationRpc, rpc } from "./rpc/transport";

export type ProfileGamesResponse = components["schemas"]["ProfileGamesResponse"];
export type RecentPlaytimeResponse =
	components["schemas"]["RecentPlaytimeResponse"];

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

/** Lists played or voted release versions from `/api/v1/me/games`, optionally after a cursor. */
export const getProfileGames = authorizationGate.guardResult("get_profile_games");

/** Gets recent release-version playtime from `/api/v1/me/playtime/recent`. */
export const getRecentPlaytime = authorizationGate.guardResult(
	"get_recent_playtime",
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
 * Uploads a queued interval as additive UTC-day sessions. A `deliveryUnknown` response is already
 * durably held by the backend and must not be retried because the server may have accepted it.
 */
export const recordPlaytime =
	authorizationGate.guardMutation("record_playtime");
