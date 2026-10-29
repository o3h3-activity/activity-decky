import {
	enqueuePlaytime,
	getPendingPlaytime,
	type PendingPlaytime,
	recordPlaytime,
} from "@api/activity";
import type { ApiResult } from "@api/rpc/result";

/** Catalog identifiers an interval is recorded against. */
export type ActivityIdentifiers = Readonly<{
	gameId: string;
	releaseId: string;
	releaseRevisionId: string;
}>;

/** One Steam user's durable interval queue and the endpoint that acknowledges its entries. */
export class PlayTimeQueue {
	constructor(private readonly steamId: string) {}

	/** Resolves whether a new interval was persisted. */
	add(appId: number, startedAt: number, endedAt: number): Promise<boolean> {
		return enqueuePlaytime(this.steamId, appId, startedAt, endedAt);
	}

	pending(): Promise<PendingPlaytime[]> {
		return getPendingPlaytime(this.steamId);
	}

	upload(
		interval: PendingPlaytime,
		{ gameId, releaseId, releaseRevisionId }: ActivityIdentifiers,
	): Promise<ApiResult> {
		return recordPlaytime(
			gameId,
			releaseId,
			releaseRevisionId,
			interval.startedAt,
			interval.endedAt,
			this.steamId,
			interval.appId,
		);
	}
}
