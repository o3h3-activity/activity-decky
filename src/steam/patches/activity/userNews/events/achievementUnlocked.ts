import type { AppAchievement } from "@decky/ui/dist/globals/steam-client/App";
import type { AchievementsProvider } from "@steam/achievements/achievementsProvider";
import { toSteamAchievement } from "@steam/achievements/toSteamAchievement";
import type { AchievementUnlockedUserNewsEvent } from "@typings/userNews";
import logger from "@utils/logger";
import { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type { UserNewsEventContext, UserNewsEventResult } from "./types";
import { UserNewsFeedEventHandler } from "./userNewsFeedEventHandler";

export class AchievementUnlockedUserNewsEventHandler extends UserNewsFeedEventHandler<"achievement_unlocked"> {
	protected readonly kind = "achievement_unlocked";
	protected readonly eventType = SteamUserNewsEventType.AchievementUnlocked;

	constructor(private readonly provider: AchievementsProvider) {
		super();
	}

	protected async create(
		events: readonly AchievementUnlockedUserNewsEvent[],
		context: UserNewsEventContext,
	): Promise<undefined | UserNewsEventResult[]> {
		if (events.length === 0) {
			return [];
		}

		const mapped = await this.provider.getAchievements(context.appId);

		if (!mapped) {
			logger.error(
				"[UserNews][Achievements] RetroAchievements metadata unavailable.",
				{ appId: context.appId },
			);

			return undefined;
		}

		const achievementMap: Map<string, AppAchievement> =
			context.activity.m_AchievementMap.get(context.appId) ??
			new Map<string, AppAchievement>();
		const nativeEvents: UserNewsEventResult[] = [];

		for (const event of events) {
			const achievementIds = [...new Set(event.achievement_ids)];
			const matchedIds = achievementIds.filter((achievementId) => {
				const achievement = mapped.platformAchievementsById.get(achievementId);

				if (achievement) {
					achievementMap.set(achievementId, {
						...toSteamAchievement(achievement),
						bAchieved: true,
						rtUnlocked: 0,
						strImage: achievement.unlocked_icon ?? achievement.icon,
					});

					return true;
				}

				logger.error(
					"[UserNews][Achievements] Unknown RetroAchievements id skipped.",
					{ appId: context.appId, achievementId },
				);

				return false;
			});

			if (matchedIds.length === 0) {
				continue;
			}

			nativeEvents.push(
				this.toResult(event, context, { achievement_names: matchedIds }),
			);
		}

		context.activity.m_AchievementMap.set(context.appId, achievementMap);

		return nativeEvents;
	}
}
