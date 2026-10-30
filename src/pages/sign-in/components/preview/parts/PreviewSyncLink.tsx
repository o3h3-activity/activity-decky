/* oxlint-disable react/forbid-component-props */
import type { ReactElement } from "react";
import { MdBlock } from "react-icons/md";

/** Connector between a Deck card and an Activity card: flowing when syncing, blocked otherwise. */
export function PreviewSyncLink({
	isSyncing,
}: Readonly<{ isSyncing: boolean }>): ReactElement {
	if (isSyncing) {
		return (
			<div className="relative mx-auto h-8 w-0.5 rounded-full bg-[#1a9fff]/30">
				<span className="absolute -left-[3px] top-0 size-2 rounded-full bg-[#1a9fff] shadow-[0_0_8px_#1a9fff] motion-safe:animate-sync-flow" />
			</div>
		);
	}

	return (
		<div className="relative mx-auto flex h-8 items-center justify-center">
			<span className="absolute inset-y-0 left-1/2 border-l border-dashed border-white/25" />

			<MdBlock className="relative size-4 rounded-full bg-[#1b2028] text-slate-500" />
		</div>
	);
}
