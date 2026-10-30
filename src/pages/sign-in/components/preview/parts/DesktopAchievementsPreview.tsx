import type { ReactElement } from "react";
import { PreviewAchievement } from "./PreviewAchievement";

const UNLOCKED_BADGES = [
	{ id: "unlocked-1", gold: true },
	{ id: "unlocked-2", gold: false },
	{ id: "unlocked-3", gold: true },
] as const;
const LOCKED_BADGE_IDS = ["locked-1", "locked-2", "locked-3"] as const;

export function DesktopAchievementsPreview(): ReactElement {
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<p className="m-0 text-[9px] leading-3 tracking-wide text-slate-400">
				ACHIEVEMENTS
			</p>

			<div className="flex flex-1 flex-col gap-2 rounded-sm bg-white/5 p-2">
				<div className="text-[8px] leading-3 text-slate-300">
					23/66 unlocked <span className="text-slate-500">(35%)</span>
				</div>

				<div className="h-1 overflow-hidden rounded-full bg-black/50">
					<div className="h-full w-[35%] origin-left bg-[#1a9fff] motion-safe:animate-progress-fill" />
				</div>

				<div className="flex items-center gap-1.5">
					<div className="w-6 shrink-0">
						<PreviewAchievement />
					</div>

					<div className="flex min-w-0 flex-1 flex-col gap-1">
						<div className="h-1 w-4/5 rounded-sm bg-white/20" />

						<div className="h-1 w-full rounded-sm bg-white/10" />

						<div className="h-1 w-3/5 rounded-sm bg-white/10" />
					</div>
				</div>

				<div className="grid grid-cols-4 items-center gap-1">
					{UNLOCKED_BADGES.map(({ id, gold }) => (
						<PreviewAchievement gold={gold} key={id} />
					))}

					<span className="flex aspect-square items-center justify-center rounded-sm bg-black/20 text-[8px] text-slate-300 ring-1 ring-inset ring-white/10">
						+18
					</span>
				</div>

				<div className="border-t border-white/10 pt-2 text-[8px] leading-3 text-slate-500">
					Locked Achievements
				</div>

				<div className="grid grid-cols-4 items-center gap-1 opacity-50">
					{LOCKED_BADGE_IDS.map((id) => (
						<PreviewAchievement key={id} />
					))}

					<span className="flex aspect-square items-center justify-center rounded-sm bg-black/20 text-[8px] text-slate-300 ring-1 ring-inset ring-white/10">
						+39
					</span>
				</div>

				<div className="mt-auto pt-2 text-right text-[8px] leading-3 text-slate-400">
					View My Achievements
				</div>
			</div>
		</div>
	);
}
