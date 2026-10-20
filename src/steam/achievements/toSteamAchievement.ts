import type { AppAchievement } from "@decky/ui/dist/globals/steam-client/App";
import type { PlatformAchievement } from "@typings/achievements";

export function toSteamAchievement(
	achievement: PlatformAchievement,
): AppAchievement {
	return {
		bAchieved: achievement.achieved,
		bHidden: achievement.hidden,
		flAchieved: achievement.global_percent,
		flCurrentProgress: 0,
		flMaxProgress: 0, // 0 keeps the progress-achievement UI hidden (guard is `flMaxProgress > 1`)
		flMinProgress: 0,
		rtUnlocked: achievement.unlock_time,
		strDescription: achievement.description,
		strID: achievement.id,
		strImage: achievement.icon,
		strName: achievement.name,
	};
}
