import { findClassModule } from "@decky/ui";

const GLOW_CLASS_NAMES = [
	"RareAchievementIconGlowContainerRoot",
	"RareAchievementIconGlowContainer",
	"RareAchievementIconGlow",
] as const;

export type RareAchievementGlowClasses = Readonly<
	Record<(typeof GLOW_CLASS_NAMES)[number], string>
>;

let cached: RareAchievementGlowClasses | undefined;

/**
 * Steam's own rare-achievement glow, from its achievement icon.
 */
export function getRareAchievementGlowClasses():
	| RareAchievementGlowClasses
	| undefined {
	if (cached !== undefined) {
		return cached;
	}

	const module = findClassModule(
		(candidate: Partial<Record<string, unknown>>) =>
			GLOW_CLASS_NAMES.every((name) => typeof candidate[name] === "string"),
	);

	if (module === undefined) {
		return undefined;
	}

	cached = {
		RareAchievementIconGlow: module.RareAchievementIconGlow,
		RareAchievementIconGlowContainer: module.RareAchievementIconGlowContainer,
		RareAchievementIconGlowContainerRoot:
			module.RareAchievementIconGlowContainerRoot,
	};

	return cached;
}
