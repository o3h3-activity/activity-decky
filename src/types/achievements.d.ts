/**
 * Achievements contracts (see server/api-types.ts and ARCHITECTURE.md §5).
 *
 * The platform returns a clean list (`PlatformAchievement`). Steam's native
 * `AppDetails.achievements` shape is `AppAchievements` / `AppAchievement`
 * from `@decky/ui`.
 */

/** One achievement as the platform reports it. */
export type PlatformAchievement = {
	achieved: boolean;
	description: string;
	global_percent: number;
	hidden: boolean;
	icon: string;
	id: string;
	name: string;
	unlock_time: number;
	/** Unlocked artwork when a provider distinguishes it from `icon`. */
	unlocked_icon?: string;
};
