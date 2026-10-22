import { getActivityUser } from "@api/account";
import { deleteComment, postComment } from "@api/activity";
import { type ApiErrorCode, isSignInError } from "@api/rpc/result";
import { callOriginal, replacePatch } from "@decky/ui";
import { EResult } from "@decky/ui/dist/globals/steam-client/shared";
import type { Games } from "@steam/games";
import { hasActivityIdentifiers } from "@steam/games/game";
import { LifetimeScope } from "@steam/lifetimeScope";
import { readRequestBody } from "@steam/patches/activity/protoRequest";
import { getAccountId, parseSteamId } from "@steam/patches/activity/steamId";
import { createSteamRpcResponse } from "@steam/patches/rpcResponse";
import { isSupportedShortcut } from "@steam/patches/shortcutEligibility";
import { AppActivityStore } from "@steam/proxy/appActivityStore";
import { PlayerService } from "@steam/proxy/playerService";
import {
	DEPENDENCY_POLL_INTERVAL_MS,
	DEPENDENCY_READY_TIMEOUT_MS,
	waitForDependency,
} from "@steam/waitForDependency";
import type { SteamPlayerService } from "@typings/playerService";
import { showErrorToast } from "@ui/toasts";
import { isObjectLike } from "@utils/isObjectLike";
import logger from "@utils/logger";
import { UserStatusDeleteConfirmationModalPatcher } from "./deleteConfirmationModalPatcher";
import {
	describeStatusMutationFailure,
	type StatusMutation,
} from "./statusMutation";
import {
	type RegisteredUserStatus,
	UserStatusRegistry,
} from "./statusRegistry";

const MILLISECONDS_PER_SECOND = 1000;

type ParsedComment = Readonly<{
	commentId: string;
	createdAt: number;
	statusText: string;
}>;
type CommentResponseCandidate = Readonly<{
	author: Readonly<{ userId: string }>;
	body: string;
	createdAt: string;
	gameId: string;
	id: string;
	ownedByCurrentUser: boolean;
	releaseId: string;
	releaseRevisionId: string;
	updatedAt: string;
}>;

type CommentResponseFields = {
	author: unknown;
	body: unknown;
	createdAt: unknown;
	gameId: unknown;
	id: unknown;
	ownedByCurrentUser: unknown;
	releaseId: unknown;
	releaseRevisionId: unknown;
	updatedAt: unknown;
};

const failedMutationResponse = createSteamRpcResponse(() => ({}), EResult.Fail);
const successfulMutationResponse = createSteamRpcResponse(() => ({}));

function hasCommentFields(value: object): value is CommentResponseFields {
	return (
		"author" in value &&
		"body" in value &&
		"createdAt" in value &&
		"gameId" in value &&
		"id" in value &&
		"ownedByCurrentUser" in value &&
		"releaseId" in value &&
		"releaseRevisionId" in value &&
		"updatedAt" in value
	);
}

function isCommentResponse(value: unknown): value is CommentResponseCandidate {
	if (!isObjectLike(value) || !hasCommentFields(value)) {
		return false;
	}

	const author = value.author;

	if (!isObjectLike(author) || !("userId" in author)) {
		return false;
	}

	const userId = author.userId;

	return (
		typeof value.id === "string" &&
		typeof value.body === "string" &&
		typeof value.createdAt === "string" &&
		typeof value.gameId === "string" &&
		typeof value.releaseId === "string" &&
		typeof value.releaseRevisionId === "string" &&
		typeof value.updatedAt === "string" &&
		typeof value.ownedByCurrentUser === "boolean" &&
		typeof userId === "string"
	);
}

function readPostedComment(value: unknown): ParsedComment | undefined {
	if (!isCommentResponse(value)) {
		return undefined;
	}

	const createdAt = Math.floor(
		Date.parse(value.createdAt) / MILLISECONDS_PER_SECOND,
	);

	return Number.isSafeInteger(createdAt)
		? { commentId: value.id, createdAt, statusText: value.body }
		: undefined;
}

/**
 * Uses Activity comments for the status posts on supported shortcut pages.
 *
 * A UserNews status event contains the author and timestamp, not its text.
 * Steam then calls `GetPostedStatus` with the author's SteamID and the event
 * time as `postid`. The registry connects that pair to an Activity comment,
 * and this patch answers with the protobuf-style methods Steam reads:
 * `accountid()`, `postid()`, `status_text()`, `deleted()`, and `appid()`.
 *
 * Posting follows a different path: the composer sends `appid` and
 * `status_text` to `PostStatusToFriends`. Deletion sends only a `postid` to
 * `DeletePostedStatus`, so it must resolve a registered current-user comment
 * before calling Activity. After deletion succeeds, the modal helper closes
 * the confirmation dialog. Requests that do not belong to our shortcuts or
 * registered comments keep Steam's original behavior.
 */
export class UserStatusPatcher {
	private readonly scope = new LifetimeScope("UserStatus");
	private readonly registry = new UserStatusRegistry();
	private readonly deleteConfirmationModalPatcher = this.scope.track(
		new UserStatusDeleteConfirmationModalPatcher(this.registry),
	);

	private installed = false;

	constructor(private readonly games: Games) {
		this.scope.addDisposer(() => this.registry.clear());
		this.scope.installGuarded(
			() => this.installPatches(),
			"[UserStatus] Failed to install patches",
		);
	}

	public get isInstalled(): boolean {
		return this.installed && !this.scope.signal.aborted;
	}

	public register(status: RegisteredUserStatus): void {
		if (!this.scope.signal.aborted) {
			this.registry.register(status);
		}
	}

	private failMutation(
		mutation: StatusMutation,
		details: Record<string, unknown>,
		error?: ApiErrorCode,
	): typeof failedMutationResponse {
		logger.error(`[UserStatus] Custom comment ${mutation} failed.`, {
			...details,
			error,
		});

		// The authorization gate already prompted sign-in for these.
		if (!isSignInError(error)) {
			showErrorToast(describeStatusMutationFailure(mutation, error));
		}

		return failedMutationResponse;
	}

	private async installPatches(): Promise<void> {
		const service = await waitForDependency(
			this.scope,
			() => PlayerService.getPlayerService(),
			DEPENDENCY_POLL_INTERVAL_MS,
			DEPENDENCY_READY_TIMEOUT_MS,
		);

		if (!service) {
			logger.error("[UserStatus] Player service not found.");
			this.unMount();

			return;
		}

		this.patchPlayerService(service);
		this.deleteConfirmationModalPatcher.install();
		this.installed = true;
	}

	private patchPlayerService(service: SteamPlayerService): void {
		this.scope.add(
			replacePatch(service, "GetPostedStatus", (args: unknown[]) => {
				const body = readRequestBody(args);
				const postId = body?.postid?.();
				const steamId = body?.steamid?.();
				const status =
					typeof postId === "string" && typeof steamId === "string"
						? this.registry.get(steamId, postId)
						: undefined;

				if (!status) {
					return callOriginal;
				}

				return Promise.resolve(
					createSteamRpcResponse(() => ({
						accountid: () => status.accountId,
						appid: () => status.appId,
						deleted: () => false,
						postid: () => status.postId,
						status_text: () => status.statusText,
					})),
				);
			}),
		);

		this.scope.add(
			replacePatch(service, "PostStatusToFriends", (args: unknown[]) => {
				const body = readRequestBody(args);
				const appId = body?.appid?.();
				const statusText = body?.status_text?.();

				if (
					typeof appId !== "number" ||
					!isSupportedShortcut(this.games, appId)
				) {
					return callOriginal;
				}

				if (
					this.scope.signal.aborted ||
					typeof statusText !== "string" ||
					statusText.trim().length === 0
				) {
					return this.failMutation("post", { appId });
				}

				return this.postShortcutComment(appId, statusText);
			}),
		);

		this.scope.add(
			replacePatch(service, "DeletePostedStatus", (args: unknown[]) => {
				const postId = readRequestBody(args)?.postid?.();
				const status =
					typeof postId === "string"
						? this.registry.getOwnedByPostId(postId)
						: undefined;

				if (!status || !postId) {
					return callOriginal;
				}

				return this.deleteShortcutComment(status, postId);
			}),
		);
	}

	private async deleteShortcutComment(
		status: RegisteredUserStatus,
		postId: string,
	): Promise<
		typeof failedMutationResponse | typeof successfulMutationResponse
	> {
		const details = { appId: status.appId, postId };

		try {
			const release = await this.games.getRelease(status.appId);

			if (!hasActivityIdentifiers(release)) {
				return this.failMutation("delete", details);
			}

			const result = await deleteComment(
				release.gameId,
				release.releaseId,
				release.revisionId,
				status.commentId,
			);

			if (!result.ok) {
				return this.failMutation("delete", details, result.error);
			}

			this.registry.deleteOwnedByPostId(postId);
			this.deleteConfirmationModalPatcher.close(postId);

			return successfulMutationResponse;
		} catch (error) {
			return this.failMutation("delete", { ...details, rejection: error });
		}
	}

	private async postShortcutComment(
		appId: number,
		statusText: string,
	): Promise<
		typeof failedMutationResponse | typeof successfulMutationResponse
	> {
		const release = await this.games.getRelease(appId);

		if (!hasActivityIdentifiers(release)) {
			showErrorToast("This game isn't recognised by Activity yet.");

			return failedMutationResponse;
		}

		const currentSteamId = parseSteamId(
			AppActivityStore.getCurrentUserSteamId(),
		);

		if (!currentSteamId || getAccountId(currentSteamId) === 0) {
			return this.failMutation("post", { appId });
		}

		try {
			const activityUser = await getActivityUser();

			if (
				activityUser &&
				activityUser.steamId !== null &&
				activityUser.steamId !== currentSteamId.toString()
			) {
				showErrorToast(
					"Your Activity account is linked to a different Steam account.",
				);

				return failedMutationResponse;
			}

			const result = await postComment(
				release.gameId,
				release.releaseId,
				release.revisionId,
				statusText,
			);

			if (!result.ok) {
				return this.failMutation("post", { appId }, result.error);
			}

			const comment = readPostedComment(result.data);

			if (!comment) {
				return this.failMutation("post", { appId });
			}

			let postId = comment.createdAt.toString();

			while (this.registry.get(currentSteamId.toString(), postId)) {
				postId = (Number(postId) + 1).toString();
			}

			this.registry.register({
				accountId: getAccountId(currentSteamId),
				appId,
				commentId: comment.commentId,
				ownedByCurrentUser: true,
				postId,
				statusText: comment.statusText,
				steamId: currentSteamId.toString(),
			});

			return successfulMutationResponse;
		} catch (error) {
			return this.failMutation("post", { appId, rejection: error });
		}
	}

	public unMount(): void {
		this.scope.unMount();
	}
}
