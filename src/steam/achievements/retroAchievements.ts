import { onDeviceAuthorizationChanged } from "@api/account";
import { getRetroAchievements } from "@api/retroAchievements";
import type { Games } from "@steam/games";
import type { PlatformAchievement } from "@typings/achievements";
import { isObjectLike } from "@utils/isObjectLike";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";
import { AchievementsProvider } from "./achievementsProvider";

const BADGE_URL = (badgeName: string, locked: boolean): string =>
	`https://media.retroachievements.org/Badge/${badgeName}${locked ? "_lock" : ""}.png`;

const MS_PER_SECOND = 1000;
const PERCENT = 100;

// Minimal slice of API_GetGameInfoAndUserProgress we consume.
interface RAItem {
	BadgeName: string;
	DateEarned?: string; // present ⇔ earned by the user; "YYYY-MM-DD HH:MM:SS" (UTC)
	Description: string;
	DisplayOrder: number;
	ID: number;
	NumAwarded: number;
	Title: string;
}
interface RAResponse {
	Achievements: Record<string, RAItem>;
	NumDistinctPlayers: number;
	Title: string;
}

function isRetroAchievementsResponse(value: unknown): value is RAResponse {
	if (!isObjectLike(value)) {
		return false;
	}

	const candidate = value as {
		Achievements?: unknown;
		NumDistinctPlayers?: unknown;
		Title?: unknown;
	};

	return (
		typeof candidate.Title === "string" &&
		typeof candidate.NumDistinctPlayers === "number" &&
		isObjectLike(candidate.Achievements)
	);
}

function parseRaDate(dateEarned: string): number {
	// RA "YYYY-MM-DD HH:MM:SS" is UTC; Date.parse needs ISO-T + Z.
	return Math.floor(
		Date.parse(`${dateEarned.replace(" ", "T")}Z`) / MS_PER_SECOND,
	);
}

function mapRaToPlatform(response: RAResponse): PlatformAchievement[] {
	const all = Object.values(response.Achievements).sort(
		(a, b) => a.DisplayOrder - b.DisplayOrder,
	);

	return all.map((item) => {
		const achieved = item.DateEarned !== undefined;

		return {
			achieved,
			description: item.Description,
			global_percent:
				response.NumDistinctPlayers > 0
					? Number(
							(
								(item.NumAwarded / response.NumDistinctPlayers) *
								PERCENT
							).toFixed(2),
						)
					: 0,
			hidden: false,
			icon: BADGE_URL(item.BadgeName, !achieved),
			id: String(item.ID),
			name: item.Title,
			unlocked_icon: BADGE_URL(item.BadgeName, false),
			unlock_time:
				achieved && item.DateEarned ? parseRaDate(item.DateEarned) : 0,
		};
	});
}

export class RetroAchievements extends AchievementsProvider {
	readonly name = "RetroAchievements";

	constructor(private readonly games: Pick<Games, "get">) {
		super();
		this.scope.addDisposer(
			onDeviceAuthorizationChanged((state) => {
				if (state.status === "signedIn" || state.status === "signedOut") {
					this.invalidate();
				}
			}),
		);
	}

	protected async fetchPlatformAchievements(
		appId: number,
	): Promise<PlatformAchievement[] | undefined> {
		const game = await this.games.get(appId);

		if (isNil(game)) {
			logger.once.debug(
				`[Achievements] No RetroAchievements game file in shortcut appId=${appId}`,
			);

			return undefined;
		}

		const response = await getRetroAchievements(game.romPath);

		if (this.disposed) {
			return undefined;
		}

		if (!isRetroAchievementsResponse(response)) {
			logger.debug(
				`[Achievements] No RetroAchievements data for appId=${appId}`,
			);

			return undefined;
		}

		const list = mapRaToPlatform(response);
		const nAchieved = list.filter((item) => item.achieved).length;

		logger.info(
			`[Achievements] RA game "${response.Title}" loaded: ${nAchieved}/${list.length} achieved`,
		);

		return list;
	}
}
