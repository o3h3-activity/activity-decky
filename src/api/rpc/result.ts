/** Mirrors `ApiErrorCode` in py_modules/activity_backend/modules/activity/results.py. */
export type ApiErrorCode =
	| "accountMismatch"
	| "deliveryUnknown"
	| "httpError"
	| "invalidRequest"
	| "invalidResponse"
	| "notSignedIn"
	| "sharingDisabled"
	| "unauthorized"
	| "unreachable";

export type ApiFailure = Readonly<{
	error: ApiErrorCode;
	ok: false;
	status: number;
}>;

/** Activity API outcome; `data` is a schema-typed but unvalidated success payload; `status` is 0 without an HTTP response. */
export type ApiResult<Data = unknown> =
	| ApiFailure
	| Readonly<{ data: Data; ok: true }>;

export function apiFailure(error: ApiErrorCode, status = 0): ApiFailure {
	return { error, ok: false, status };
}

/** Failures the user resolves by signing in again: no local token, or the API revoked it. */
export function isSignInError(error: ApiErrorCode | undefined): boolean {
	return error === "notSignedIn" || error === "unauthorized";
}
