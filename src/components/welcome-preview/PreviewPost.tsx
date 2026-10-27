import type { ReactElement } from "react";
import { PreviewAvatar } from "./PreviewAvatar";

type PreviewPostProps = Readonly<{
	author: string;
	/** Each change replays the sent-comment flash; 0 shows none. */
	sentCount?: number;
	short?: boolean;
}>;

export function PreviewPost({
	author,
	sentCount = 0,
	short = false,
}: PreviewPostProps): ReactElement {
	return (
		<div className="relative flex flex-col gap-2 rounded-sm bg-white/5 p-2">
			{sentCount > 0 && (
				<span
					className="pointer-events-none absolute inset-0 rounded-sm bg-[#1a9fff]/15 opacity-0 ring-1 ring-[#1a9fff]/60 ring-inset motion-safe:animate-post-sent"
					key={sentCount}
				/>
			)}

			<div className="flex items-center gap-2">
				<PreviewAvatar />

				<span className="font-sans text-xs font-medium leading-4 text-slate-300">
					{author}
				</span>
			</div>

			<div className="h-1 w-4/5 rounded-sm bg-white/15" />

			{!short && <div className="h-1 w-3/5 rounded-sm bg-white/10" />}
		</div>
	);
}
