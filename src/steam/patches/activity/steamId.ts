import type { SteamId } from "@typings/friendStore";
import { isObjectLike } from "@utils/isObjectLike";

// biome-ignore format: keep uppercase hex digits (oxlint unicorn/number-literal-case)
const MAX_UNSIGNED_64_BIT_INTEGER = 0xFF_FF_FF_FF_FF_FF_FF_FFn;
// biome-ignore format: keep uppercase hex digits (oxlint unicorn/number-literal-case)
const ACCOUNT_ID_MASK = 0xFF_FF_FF_FFn;

export function isSteamId(value: unknown): value is SteamId {
	if (!isObjectLike(value) || !("ConvertTo64BitString" in value)) {
		return false;
	}

	return typeof value.ConvertTo64BitString === "function";
}

export function parseSteamId(value: unknown): bigint | undefined {
	if (typeof value !== "string" || !/^\d+$/u.test(value)) {
		return undefined;
	}

	try {
		const steamId = BigInt(value);

		return steamId > 0n && steamId <= MAX_UNSIGNED_64_BIT_INTEGER
			? steamId
			: undefined;
	} catch {
		return undefined;
	}
}

export function getAccountId(steamId: bigint): number {
	return Number(steamId & ACCOUNT_ID_MASK);
}
