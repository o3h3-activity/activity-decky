import type { ReactElement } from "react";
import { PreviewAvatar } from "./PreviewAvatar";

const MESSAGES = ["Reply from Desktop Mode", "Post from Game Mode"] as const;

export function DesktopActivityPreview(): ReactElement {
	return (
		<div className="flex min-w-0 flex-col gap-2">
			<p className="m-0 text-[9px] leading-3 tracking-wide text-slate-400">
				ACTIVITY
			</p>

			<div className="rounded-sm bg-black/20 px-2 py-1.5 text-[8px] leading-3 text-slate-500 italic">
				Say something about this game…
			</div>

			<div className="flex items-center gap-2 text-[8px] leading-3 text-slate-400">
				TODAY
				<span className="h-px flex-1 bg-white/10" />
			</div>

			{MESSAGES.map((message) => (
				<div className="flex flex-col gap-1.5" key={message}>
					<div className="flex items-center gap-1.5">
						<PreviewAvatar />

						<div className="flex min-w-0 flex-1 flex-col gap-1">
							<div className="h-1 w-3/5 rounded-sm bg-white/15" />

							<div className="h-1 w-4/5 rounded-sm bg-white/10" />
						</div>
					</div>

					<div className="rounded-sm bg-white/5 px-2 py-2.5 text-[9px] leading-3 text-slate-300">
						{message}
					</div>
				</div>
			))}

			<div className="flex items-center gap-2 text-[8px] leading-3 text-slate-500">
				<span className="h-px flex-1 bg-white/10" />

				<span>End of Activity</span>

				<span className="h-px flex-1 bg-white/10" />
			</div>
		</div>
	);
}
