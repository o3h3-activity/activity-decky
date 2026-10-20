import type { ApiErrorCode } from "@api/rpc/result";

export type StatusMutation = "delete" | "post";

/** Toast text for a failed comment write; `error` undefined = RPC rejection or malformed response. */
export function describeStatusMutationFailure(
	mutation: StatusMutation,
	error?: ApiErrorCode,
): string {
	return error === "unreachable"
		? "Could not reach the Activity API."
		: `Could not ${mutation} your comment.`;
}
