import { isObjectLike } from "@utils/isObjectLike";

type PlayTimeInterval = Readonly<{
	appId: number;
	endedAt: number;
	startedAt: number;
}>;

function appId(value: unknown): number | undefined {
	if (typeof value !== "number" && typeof value !== "string") {
		return undefined;
	}

	if (typeof value === "string" && value.trim() === "") {
		return undefined;
	}

	const parsed = Number(value);

	return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Parses only the narrow event shape emitted by the PlayTime Decky plugin. Event payloads cross a
 * plugin boundary, so reject malformed values before looking up a game or touching the durable
 * outbox.
 */
export function parsePlayTimeInterval(
	event: Event,
): PlayTimeInterval | undefined {
	const detail = (event as CustomEvent<unknown>).detail;

	if (!isObjectLike(detail)) {
		return undefined;
	}

	const candidate = detail as {
		endedAt?: unknown;
		game?: { id?: unknown };
		startedAt?: unknown;
	};
	const { endedAt, game, startedAt } = candidate;

	if (
		!isObjectLike(game) ||
		typeof startedAt !== "number" ||
		typeof endedAt !== "number" ||
		!Number.isSafeInteger(startedAt) ||
		!Number.isSafeInteger(endedAt) ||
		endedAt < startedAt
	) {
		return undefined;
	}

	const parsedAppId = appId(game.id);

	return parsedAppId === undefined
		? undefined
		: { appId: parsedAppId, endedAt, startedAt };
}
