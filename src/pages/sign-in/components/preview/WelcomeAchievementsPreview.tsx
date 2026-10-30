import type { ReactElement } from "react";
import { PreviewAchievement } from "./parts/PreviewAchievement";

/** Badges beside the selected achievement; `gold` marks rare ones. */
const HIGHLIGHTED_ACHIEVEMENTS = [
	{ id: "highlighted-1", gold: true },
	{ id: "highlighted-2", gold: false },
	{ id: "highlighted-3", gold: true },
] as const;

const LOCKED_ACHIEVEMENT_IDS = [
	"locked-1",
	"locked-2",
	"locked-3",
	"locked-4",
	"locked-5",
	"locked-6",
	"locked-7",
	"locked-8",
] as const;

/** Compact achievements illustration; no real progress or account data. */
export function WelcomeAchievementsPreview(): ReactElement {
	return (
		<figure
			aria-label="Achievements layout with progress, a selected achievement, gold-highlighted badges, and locked achievements."
			className="m-0 box-border w-full max-w-[360px] rounded-md bg-[#1b2028] p-3"
		>
			<div aria-hidden="true" className="flex flex-col gap-3">
				<p className="m-0 font-sans text-xs font-medium leading-4 text-slate-300 motion-safe:animate-preview-in">
					Achievements
				</p>

				<div className="flex items-center gap-3 rounded-sm bg-white/5 p-2 motion-safe:animate-preview-in motion-safe:[animation-delay:80ms]">
					<div className="h-1.5 w-20 shrink-0 rounded-sm bg-white/15" />

					<div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-black/25">
						<div className="h-full w-1/3 origin-left rounded-full bg-[#1a9fff] motion-safe:animate-progress-fill" />
					</div>
				</div>

				<div className="flex items-center gap-2 motion-safe:animate-preview-in motion-safe:[animation-delay:160ms]">
					<div className="relative flex min-w-0 flex-1 items-center gap-2 rounded-sm bg-white/5 p-2 ring-1 ring-inset ring-white/15">
						<span className="pointer-events-none absolute inset-0 rounded-sm ring-1 ring-inset ring-white/45 motion-safe:animate-focus-breathe" />

						<div className="w-9 shrink-0">
							<PreviewAchievement />
						</div>

						<div className="flex min-w-0 flex-1 flex-col gap-1.5">
							<div className="h-1.5 w-3/5 rounded-sm bg-white/20" />

							<div className="h-1 w-full rounded-sm bg-white/10" />

							<div className="h-1 w-4/5 rounded-sm bg-white/10" />
						</div>
					</div>

					<div className="grid w-28 shrink-0 grid-cols-3 gap-2">
						{HIGHLIGHTED_ACHIEVEMENTS.map(({ id, gold }) => (
							<PreviewAchievement gold={gold} key={id} />
						))}
					</div>
				</div>

				<div className="motion-safe:animate-preview-in motion-safe:[animation-delay:240ms]">
					<div className="mb-2 h-1.5 w-24 rounded-sm bg-white/15" />

					<div className="grid grid-cols-8 gap-1.5 opacity-50">
						{LOCKED_ACHIEVEMENT_IDS.map((id) => (
							<PreviewAchievement key={id} />
						))}
					</div>
				</div>
			</div>
		</figure>
	);
}
