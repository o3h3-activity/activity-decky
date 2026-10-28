import { isNil } from "es-toolkit";
import type { ReactElement } from "react";
import { getRareAchievementGlowClasses } from "./rareAchievementGlowClasses";

type PreviewAchievementProps = Readonly<{
	gold?: boolean;
}>;

export function PreviewAchievement({
	gold = false,
}: PreviewAchievementProps): ReactElement {
	const glow = gold ? getRareAchievementGlowClasses() : undefined;

	return (
		<div className="relative aspect-square">
			{!isNil(glow) && (
				<div
					aria-hidden="true"
					className={glow.RareAchievementIconGlowContainerRoot}
				>
					<div className={glow.RareAchievementIconGlowContainer}>
						<div className={glow.RareAchievementIconGlow} />
					</div>
				</div>
			)}

			<div
				className={
					gold
						? "relative size-full rounded-sm bg-[#3b414a] shadow-[0_0_2px_1px_#ffb84e99,0_0_16px_1px_#ffb84e66]"
						: "relative size-full rounded-sm bg-white/10 ring-1 ring-inset ring-white/10"
				}
			>
				<div
					className={
						gold
							? "absolute inset-1 rounded-[1px] bg-amber-200/25"
							: "absolute inset-1 rounded-[1px] bg-white/10"
					}
				/>
			</div>
		</div>
	);
}
