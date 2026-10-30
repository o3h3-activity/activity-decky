/* oxlint-disable react/forbid-component-props */
import type { ReactElement } from "react";
import { MdCheckCircle, MdVideogameAsset } from "react-icons/md";
import { PreviewSyncLink } from "./parts/PreviewSyncLink";

/** Classes are literal so Tailwind emits them. */
const GAMES = [
	{ delay: "", id: "ps2", platform: "PS2", title: "w-3/5" },
	{
		delay: "motion-safe:[animation-delay:80ms]",
		id: "ps1",
		platform: "PS1",
		title: "w-2/5",
	},
	{
		delay: "motion-safe:[animation-delay:160ms]",
		id: "psp",
		platform: "PSP",
		title: "w-1/2",
	},
] as const;

function renderDeckLibrary(): ReactElement {
	return (
		<div className="flex flex-col gap-1.5 rounded-sm bg-white/5 p-2">
			<div className="mb-0.5 flex items-center justify-between">
				<span className="flex items-center gap-1.5 text-xs leading-4 font-medium text-slate-300">
					<MdVideogameAsset className="size-3.5 text-[#1a9fff]" />
					On this Deck
				</span>

				<span className="text-[10px] leading-3 text-slate-400">
					{GAMES.length} games
				</span>
			</div>

			{GAMES.map(({ delay, id, platform, title }) => (
				<div
					className={`flex items-center gap-2 rounded-sm bg-white/5 p-1.5 motion-safe:animate-preview-in ${delay}`}
					key={id}
				>
					<span className="w-8 shrink-0 rounded-sm bg-white/10 py-0.5 text-center text-[9px] leading-3 font-bold text-slate-300">
						{platform}
					</span>

					<div className={`h-1.5 rounded-sm bg-white/15 ${title}`} />
				</div>
			))}
		</div>
	);
}

/** Keyed by the choice: remounting replays the entrance, so each choice visibly lands. */
function renderActivityLibrary(isSyncing: boolean): ReactElement {
	return (
		<div
			className={`flex flex-col gap-2 rounded-sm p-2 motion-safe:animate-preview-in ${isSyncing ? "bg-white/5 ring-1 ring-[#1a9fff]/40 ring-inset" : "bg-white/[0.03] opacity-50"}`}
			key={String(isSyncing)}
		>
			<div className="flex items-center justify-between">
				<span className="text-xs leading-4 font-medium text-slate-300">
					Your games
				</span>

				<span className="text-[10px] leading-3 text-slate-400">Activity</span>
			</div>

			{isSyncing ? (
				<div className="flex gap-1.5">
					{GAMES.map(({ id, platform }) => (
						<span
							className="flex flex-1 items-center justify-center gap-1 rounded-sm bg-[#1a9fff]/15 py-1 text-[10px] leading-3 font-bold text-sky-200"
							key={id}
						>
							<MdCheckCircle className="size-3 text-[#1a9fff]" />

							{platform}
						</span>
					))}
				</div>
			) : (
				<span className="text-[11px] leading-4 text-slate-500">
					No games synced yet
				</span>
			)}
		</div>
	);
}

/** Deck-to-Activity library illustration that follows the setup choice; no real games. */
export function WelcomeGameSyncPreview({
	isSyncing,
}: Readonly<{ isSyncing: boolean }>): ReactElement {
	return (
		<figure
			aria-label={
				isSyncing
					? "Three PlayStation, PlayStation 2 and PSP games on this Deck appear in your Activity games."
					: "Three games on this Deck; none are synced to Activity until you open them."
			}
			className="m-0 box-border w-full max-w-[360px] rounded-md bg-[#1b2028] p-3"
		>
			<div aria-hidden="true" className="flex flex-col gap-2.5 font-sans">
				{renderDeckLibrary()}

				<PreviewSyncLink isSyncing={isSyncing} />

				{renderActivityLibrary(isSyncing)}
			</div>
		</figure>
	);
}
