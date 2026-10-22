import { readRequestBody } from "@steam/patches/activity/protoRequest";
import {
	isNonNegativeSafeInteger,
	isPositiveSafeInteger,
} from "@utils/safeInteger";
import type { UserNewsRequest } from "../events/types";

/**
 * Reads the app filter and time window from Steam's `GetUserNews` request.
 *
 * A zero `filterappid` means the global feed, which we leave to Steam.
 * Malformed fields and reversed time windows also return `undefined` rather
 * than being treated as shortcut requests.
 *
 * Steam sends an end time of zero for new events and a start time of zero
 * for history. We treat zero as an open bound and include events on either
 * nonzero boundary when selecting the replacement response.
 */
export abstract class UserNewsRequests {
	public static read(args: unknown[]): undefined | UserNewsRequest {
		const body = readRequestBody(args);
		const appId = body?.filterappid?.();
		const count = body?.count?.();
		const endTime = body?.endtime?.();
		const startTime = body?.starttime?.();

		if (
			!isPositiveSafeInteger(appId) ||
			!isPositiveSafeInteger(count) ||
			!isNonNegativeSafeInteger(endTime) ||
			!isNonNegativeSafeInteger(startTime) ||
			(startTime !== 0 && endTime !== 0 && startTime > endTime)
		) {
			return undefined;
		}

		return { appId, count, endTime, startTime };
	}

	public static isWithinWindow(
		request: UserNewsRequest,
		eventTime: number,
	): boolean {
		return (
			(request.startTime === 0 || eventTime >= request.startTime) &&
			(request.endTime === 0 || eventTime <= request.endTime)
		);
	}
}
