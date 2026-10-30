/* oxlint-disable react/forbid-component-props */
import { Focusable, Spinner } from "@decky/ui";
import { isNil } from "es-toolkit";
import { type CSSProperties, type ReactElement, useMemo } from "react";
import { MdCheckCircle, MdErrorOutline, MdWarningAmber } from "react-icons/md";
import {
	GAME_SYNC_FAILED_MESSAGE,
	type GameSyncPhase,
	gameSyncResultMessage,
} from "./useGameSyncChoice";

type StartedPhase = Exclude<GameSyncPhase, { status: "choosing" }>;

function headline(phase: StartedPhase): string {
	if (phase.status === "finished") {
		return gameSyncResultMessage(phase.progress);
	}

	if (phase.status === "failed") {
		return GAME_SYNC_FAILED_MESSAGE;
	}

	if (isNil(phase.progress)) {
		return "Finding the games on this Deck…";
	}

	return `Syncing batch ${phase.progress.batch + 1} of ${phase.progress.batches}…`;
}

function renderIcon(status: StartedPhase["status"]): ReactElement {
	if (status === "finished") {
		return <MdCheckCircle className="size-5 shrink-0 text-[#90ba3c]" />;
	}

	if (status === "failed") {
		return <MdErrorOutline className="size-5 shrink-0 text-red-400" />;
	}

	return (
		<span className="inline-flex size-5 shrink-0 [&>svg]:size-full">
			<Spinner />
		</span>
	);
}

/** Replaces the Yes/No cards once syncing starts, and holds focus while nothing else is actionable. */
export function GameSyncStatus({
	phase,
}: Readonly<{ phase: StartedPhase }>): ReactElement {
	const { progress, status } = phase;
	const isSyncing = status === "syncing";
	const ratio =
		isNil(progress) || progress.total === 0
			? 0
			: progress.answered / progress.total;
	const fillStyle = useMemo<CSSProperties>(
		() => ({ transform: `scaleX(${ratio})` }),
		[ratio],
	);

	return (
		<Focusable
			className="flex flex-col gap-2.5 rounded-md bg-white/5 p-3 ring-1 ring-white/10 ring-inset"
			focusable
			noFocusRing
			// Starting removes the focused Yes/No card; this keeps focus on the page while nothing is actionable.
			preferredFocus={isSyncing}
		>
			<div className="flex items-center gap-3">
				{renderIcon(status)}

				<output className="text-sm leading-5 font-semibold text-white">
					{headline(phase)}
				</output>
			</div>

			{!isNil(progress) && progress.total > 0 && (
				<>
					<div className="h-2 overflow-hidden rounded-full bg-white/10">
						<div
							className={`h-full origin-left rounded-full transition-transform duration-500 ${status === "failed" ? "bg-red-400/70" : "bg-[#1a9fff]"} ${isSyncing ? "motion-safe:animate-pulse" : ""}`}
							style={fillStyle}
						/>
					</div>

					<div className="flex justify-between text-xs leading-4 text-slate-400 tabular-nums">
						<span>{`${progress.answered} of ${progress.total} games synced`}</span>

						<span>{`${progress.total - progress.answered} remaining`}</span>
					</div>
				</>
			)}

			{isSyncing && (
				<p className="m-0 flex items-start gap-2 text-sm leading-5 text-amber-300">
					<MdWarningAmber aria-hidden="true" className="mt-0.5 shrink-0" />

					<span>
						Please don’t turn off your Steam Deck, put it to sleep, or
						disconnect it from the internet until syncing finishes.
					</span>
				</p>
			)}
		</Focusable>
	);
}
