import { readRequestBody } from "@steam/patches/activity/protoRequest";
import {
	isNonNegativeSafeInteger,
	isPositiveSafeInteger,
} from "@utils/safeInteger";
import type { UserNewsRequest } from "../events/types";

export abstract class UserNewsRequests {
	/** Undefined for malformed bodies or inverted windows so Steam serves the request natively. */
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

	/** Zero bounds are open-ended; bounds are inclusive. */
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
