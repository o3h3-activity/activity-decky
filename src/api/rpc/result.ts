/** Mirrors `ApiErrorCode` in py_modules/activity_backend/modules/activity/results.py. */
export type ApiErrorCode =
	| "httpError"
	| "invalidRequest"
	| "invalidResponse"
	| "notSignedIn"
	| "unauthorized"
	| "unreachable";

export type ApiFailure = Readonly<{
	error: ApiErrorCode;
	ok: false;
	status: number;
}>;

/** Activity API outcome; `data` is unvalidated JSON for the caller's parser; `status` is 0 without an HTTP response. */
export type ApiResult = ApiFailure | Readonly<{ data: unknown; ok: true }>;

export function apiFailure(error: ApiErrorCode, status = 0): ApiFailure {
	return { error, ok: false, status };
}

/** Failures the user resolves by signing in again: no local token, or the API revoked it. */
export function isSignInError(error: ApiErrorCode | undefined): boolean {
	return error === "notSignedIn" || error === "unauthorized";
}
