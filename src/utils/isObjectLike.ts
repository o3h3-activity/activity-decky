/** Non-null `typeof "object"` value; functions excluded. */
export function isObjectLike(value: unknown): value is object {
	return typeof value === "object" && value !== null;
}
