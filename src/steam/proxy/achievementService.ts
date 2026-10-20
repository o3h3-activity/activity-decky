import { findModuleExport } from "@decky/ui";
import { isObjectLike } from "@utils/isObjectLike";

type NativeAchievementService = {
	GetGameAchievements(...args: unknown[]): unknown;
	GetGlobalAchievementPercentages(...args: unknown[]): unknown;
	GetUserAchievements(...args: unknown[]): unknown;
};

export class AchievementService {
	public static getAchievementService(): Nullable<NativeAchievementService> {
		const service: unknown = findModuleExport((exported: unknown) => {
			if (!isObjectLike(exported)) {
				return false;
			}

			const candidate = exported as Partial<NativeAchievementService>;

			return (
				typeof candidate.GetGameAchievements === "function" &&
				typeof candidate.GetGlobalAchievementPercentages === "function" &&
				typeof candidate.GetUserAchievements === "function"
			);
		});

		return service as Nullable<NativeAchievementService>;
	}
}
