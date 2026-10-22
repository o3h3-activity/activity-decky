export type RegisteredUserStatus = Readonly<{
	accountId: number;
	appId: number;
	commentId: string;
	ownedByCurrentUser: boolean;
	postId: string;
	statusText: string;
	steamId: string;
}>;

/**
 * Connects Steam's status IDs to Activity comment IDs.
 *
 * Reading a status uses `(steamid, postid)`, but deleting one uses only
 * `postid`. Since post IDs come from event timestamps, different authors
 * can share one. The main index includes both values; the deletion index
 * contains only the current user's comments, so another author's status
 * cannot be selected for deletion.
 */
export class UserStatusRegistry {
	private readonly statuses = new Map<string, RegisteredUserStatus>();
	private readonly ownedStatusesByPostId = new Map<
		string,
		RegisteredUserStatus
	>();

	public register(status: RegisteredUserStatus): void {
		this.statuses.set(this.getLookupKey(status.steamId, status.postId), status);

		if (status.ownedByCurrentUser) {
			this.ownedStatusesByPostId.set(status.postId, status);
		}
	}

	public get(
		steamId: string,
		postId: string,
	): RegisteredUserStatus | undefined {
		return this.statuses.get(this.getLookupKey(steamId, postId));
	}

	public getOwnedByPostId(postId: string): RegisteredUserStatus | undefined {
		return this.ownedStatusesByPostId.get(postId);
	}

	public deleteOwnedByPostId(postId: string): void {
		const status = this.ownedStatusesByPostId.get(postId);

		if (!status) {
			return;
		}

		this.statuses.delete(this.getLookupKey(status.steamId, postId));
		this.ownedStatusesByPostId.delete(postId);
	}

	public clear(): void {
		this.statuses.clear();
		this.ownedStatusesByPostId.clear();
	}

	private getLookupKey(steamId: string, postId: string): string {
		return `${steamId}:${postId}`;
	}
}
