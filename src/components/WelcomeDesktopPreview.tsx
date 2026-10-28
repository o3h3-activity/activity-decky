/* oxlint-disable react/forbid-component-props */
import type { ReactElement } from "react";
import {
	MdFavorite,
	MdPlayArrow,
	MdSettings,
	MdSportsEsports,
	MdThumbDown,
	MdThumbUp,
} from "react-icons/md";
import { DesktopAchievementsPreview } from "./welcome-preview/DesktopAchievementsPreview";
import { DesktopActivityPreview } from "./welcome-preview/DesktopActivityPreview";

/** Compact Desktop Mode illustration; no real game, activity, or account data. */
export function WelcomeDesktopPreview(): ReactElement {
	return (
		<figure
			aria-label="Steam Desktop Mode game page with a Play button, comments from Game Mode and Desktop Mode, and an achievements sidebar."
			className="m-0 box-border w-full max-w-[360px] overflow-hidden rounded-md bg-[#1b2028]"
		>
			<div aria-hidden="true" className="font-sans">
				<div className="flex items-center gap-2 border-b border-black/30 bg-white/5 px-2 py-1.5 motion-safe:animate-preview-in">
					<span className="flex items-center gap-1 rounded-sm bg-linear-to-r from-[#75b022] to-[#00a44b] px-3 py-1 text-[10px] leading-3 font-medium text-white">
						<MdPlayArrow className="size-3" />
						PLAY
					</span>

					<span className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] text-slate-300">
						<span className="size-3.5 shrink-0 rounded-[2px] bg-white/15" />

						<span className="truncate">Tekken 5</span>
					</span>

					<MdSettings className="size-4 rounded-sm bg-white/5 p-1 text-slate-400" />

					<MdSportsEsports className="size-4 rounded-sm bg-white/5 p-1 text-slate-400" />

					<MdFavorite className="size-4 rounded-sm bg-white/5 p-1 text-slate-400" />
				</div>

				<div className="flex flex-col gap-3 p-2.5">
					<div className="flex items-center gap-2 rounded-sm bg-[#424b57] p-2 motion-safe:animate-preview-in motion-safe:[animation-delay:80ms]">
						<div className="min-w-0 flex-1 text-[8px] leading-3 text-slate-300">
							<div className="text-[#67c1f5]">You’ve played for 13 hours</div>
							Would you recommend this game?
						</div>

						<span className="flex items-center gap-1 rounded-sm bg-[#67c1f5]/15 px-2 py-1 text-[8px] leading-3 text-[#67c1f5]">
							<MdThumbUp className="size-3" />
							Yes
						</span>

						<span className="flex items-center gap-1 rounded-sm bg-[#67c1f5]/15 px-2 py-1 text-[8px] leading-3 text-[#67c1f5]">
							<MdThumbDown className="size-3" />
							No
						</span>
					</div>

					<div className="grid grid-cols-[minmax(0,1fr)_112px] gap-3 motion-safe:animate-preview-in motion-safe:[animation-delay:160ms]">
						<DesktopActivityPreview />

						<DesktopAchievementsPreview />
					</div>
				</div>
			</div>
		</figure>
	);
}
