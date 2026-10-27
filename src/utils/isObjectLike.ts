import { isNil } from "es-toolkit";

/** Non-null `typeof "object"` value; functions excluded. */
export function isObjectLike(value: unknown): value is object {
	return typeof value === "object" && !isNil(value);
}
