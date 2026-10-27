import type { ActivityFriend } from "@typings/virtualFriend";
import { isObjectLike } from "@utils/isObjectLike";
import { isNil } from "es-toolkit";
import { getAccountId, parseSteamId } from "./steamId";

/** Validates an Activity API user and preserves its backend identity separately from the Steam friend projection; null profile fields are dropped. */
export function readActivityUser(
	value: unknown,
): Readonly<{ friend: ActivityFriend; userId: string }> | undefined {
	if (
		!isObjectLike(value) ||
		!("steamId" in value) ||
		!("userId" in value) ||
		typeof value.userId !== "string"
	) {
		return undefined;
	}

	const steamId = parseSteamId(value.steamId);

	if (!steamId || getAccountId(steamId) === 0) {
		return undefined;
	}

	const nickname = "nickname" in value ? value.nickname : undefined;
	const avatarUrl = "avatarUrl" in value ? value.avatarUrl : undefined;

	if (
		(!isNil(nickname) && typeof nickname !== "string") ||
		(!isNil(avatarUrl) && typeof avatarUrl !== "string")
	) {
		return undefined;
	}

	return {
		friend: {
			...(typeof avatarUrl === "string" ? { avatarUrl } : {}),
			...(typeof nickname === "string" ? { nickname } : {}),
			steamId: steamId.toString(),
		},
		userId: value.userId,
	};
}
