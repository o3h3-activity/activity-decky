import { isPositiveSafeInteger } from "@utils/safeInteger";

/** Protobuf request wrapper Steam passes as the second argument of service RPCs. */
export type ProtoRequest = {
	Body?: () => {
		appid?: () => number;
		count?: () => number;
		endtime?: () => number;
		filterappid?: () => number;
		postid?: () => string;
		starttime?: () => number;
		status_text?: () => string;
		steamid?: () => string;
	};
};

/** Unwraps the protobuf body; request parsers validate their own fields. */
export function readRequestBody(
	args: unknown[],
): ReturnType<NonNullable<ProtoRequest["Body"]>> | undefined {
	return (args[1] as ProtoRequest | undefined)?.Body?.();
}

export function readRequestAppId(
	args: unknown[],
	reader: "appid" | "filterappid",
): number | undefined {
	const body = readRequestBody(args);
	const appId = reader === "appid" ? body?.appid?.() : body?.filterappid?.();

	return isPositiveSafeInteger(appId) ? appId : undefined;
}
