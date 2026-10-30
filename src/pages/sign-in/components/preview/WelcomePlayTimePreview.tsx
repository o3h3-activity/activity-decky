/* oxlint-disable react/forbid-component-props */
import type { ReactElement } from "react";
import { MdTimer } from "react-icons/md";
import { PreviewAvatar } from "./parts/PreviewAvatar";
import { PreviewSyncLink } from "./parts/PreviewSyncLink";

/** One bar per weekday; the last is today's session. Classes are literal so Tailwind emits them. */
const WEEK = [
	{ bar: "h-[35%] motion-safe:[animation-delay:120ms]", id: "mon", label: "M" },
	{ bar: "h-[60%] motion-safe:[animation-delay:160ms]", id: "tue", label: "T" },
	{ bar: "h-[20%] motion-safe:[animation-delay:200ms]", id: "wed", label: "W" },
	{ bar: "h-[75%] motion-safe:[animation-delay:240ms]", id: "thu", label: "T" },
	{ bar: "h-[45%] motion-safe:[animation-delay:280ms]", id: "fri", label: "F" },
	{ bar: "h-full motion-safe:[animation-delay:320ms]", id: "sat", label: "S" },
	{ bar: "h-[55%] motion-safe:[animation-delay:360ms]", id: "sun", label: "S" },
] as const;

const TODAY_INDEX = WEEK.length - 1;

function renderWeek(): ReactElement {
	return (
		<div className="rounded-sm bg-white/5 p-2 motion-safe:animate-preview-in">
			<div className="mb-2 flex items-center justify-between">
				<span className="flex items-center gap-1.5 text-xs leading-4 font-medium text-slate-300">
					<MdTimer className="size-3.5 text-[#1a9fff]" />
					PlayTime
				</span>

				<span className="text-[10px] leading-3 text-slate-400">This week</span>
			</div>

			<div className="flex h-16 items-end gap-1.5">
				{WEEK.map(({ bar, id }, index) => (
					<div
						className={`flex-1 origin-bottom rounded-t-sm motion-safe:animate-bar-grow ${bar} ${index === TODAY_INDEX ? "bg-[#1a9fff]" : "bg-white/15"}`}
						key={id}
					/>
				))}
			</div>

			<div className="mt-1 flex gap-1.5">
				{WEEK.map(({ id, label }, index) => (
					<span
						className={`flex-1 text-center text-[9px] leading-3 ${index === TODAY_INDEX ? "text-sky-200" : "text-slate-500"}`}
						key={id}
					>
						{label}
					</span>
				))}
			</div>
		</div>
	);
}

function renderSession(): ReactElement {
	return (
		<div className="flex items-center gap-2 rounded-sm bg-white/5 p-2 motion-safe:animate-preview-in motion-safe:[animation-delay:80ms]">
			<span className="size-6 shrink-0 rounded-sm bg-white/15" />

			<div className="flex min-w-0 flex-1 flex-col gap-1.5">
				<div className="h-1.5 w-3/5 rounded-sm bg-white/15" />

				<div className="h-1 w-2/5 rounded-sm bg-white/10" />
			</div>

			<span className="text-xs leading-4 font-medium text-white tabular-nums">
				1h 24m
			</span>
		</div>
	);
}

/** Keyed by the choice: remounting replays the entrance, so each choice visibly lands. */
function renderActivityPost(isSharing: boolean): ReactElement {
	return (
		<div
			className={`flex flex-col gap-2 rounded-sm p-2 motion-safe:animate-preview-in ${isSharing ? "bg-white/5 ring-1 ring-[#1a9fff]/40 ring-inset" : "bg-white/[0.03] opacity-50"}`}
			key={String(isSharing)}
		>
			<div className="flex items-center gap-2">
				<PreviewAvatar inGame={isSharing} />

				<span className="text-xs leading-4 font-medium text-slate-300">
					You
				</span>

				<span className="ml-auto text-[10px] leading-3 text-slate-400">
					Activity
				</span>
			</div>

			{isSharing ? (
				<span className="text-[11px] leading-4 text-[#67c1f5]">
					Played for 1h 24m today
				</span>
			) : (
				<span className="text-[11px] leading-4 text-slate-500">
					No play time shared
				</span>
			)}

			<div className="h-1 w-3/5 rounded-sm bg-white/10" />
		</div>
	);
}

/** PlayTime-to-Activity illustration that follows the setup choice; no real play data. */
export function WelcomePlayTimePreview({
	isSharing,
}: Readonly<{ isSharing: boolean }>): ReactElement {
	return (
		<figure
			aria-label={
				isSharing
					? "PlayTime’s weekly chart and today’s 1 hour 24 minute session flow into your Activity profile."
					: "PlayTime’s weekly chart and today’s session stay on this Deck; your Activity profile shows no play time."
			}
			className="m-0 box-border w-full max-w-[360px] rounded-md bg-[#1b2028] p-3"
		>
			<div aria-hidden="true" className="flex flex-col gap-2.5 font-sans">
				{renderWeek()}

				{renderSession()}

				<PreviewSyncLink isSyncing={isSharing} />

				{renderActivityPost(isSharing)}
			</div>
		</figure>
	);
}
