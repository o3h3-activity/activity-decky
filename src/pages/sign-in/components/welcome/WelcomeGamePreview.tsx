import type { ReactElement } from "react";
import { PreviewAvatar } from "./preview/PreviewAvatar";
import { PreviewComposer } from "./preview/PreviewComposer";
import { PreviewPost } from "./preview/PreviewPost";

export function WelcomeGamePreview(): ReactElement {
	return (
		<figure
			aria-label="Activity layout: two friends have played recently, one is playing now; you type and send a comment, followed by two friends’ comments."
			className="m-0 box-border w-full max-w-[360px] rounded-md bg-[#1b2028] p-3"
		>
			<div aria-hidden="true" className="flex flex-col gap-2.5">
				<div className="motion-safe:animate-preview-in">
					<p className="m-0 mb-2 font-sans text-[11px] font-medium leading-4 text-slate-400">
						2 friends have played recently
					</p>

					<div className="flex gap-5 rounded-sm bg-white/5 p-2">
						<div className="flex min-w-0 flex-1 items-center gap-2">
							<PreviewAvatar inGame />

							<div className="flex min-w-0 flex-1 flex-col gap-1.5">
								<div className="h-1.5 w-3/5 rounded-sm bg-white/15" />

								<div className="h-1 w-4/5 rounded-sm bg-[#90ba3c]/40" />
							</div>
						</div>

						<div className="flex min-w-0 flex-1 items-center gap-2">
							<PreviewAvatar />

							<div className="flex min-w-0 flex-1 flex-col gap-1.5">
								<div className="h-1.5 w-2/5 rounded-sm bg-white/15" />

								<div className="h-1 w-3/5 rounded-sm bg-white/10" />
							</div>
						</div>
					</div>
				</div>

				<PreviewComposer />

				<div className="motion-safe:animate-preview-in motion-safe:[animation-delay:240ms]">
					<PreviewPost author="Your friend" />
				</div>

				<div className="motion-safe:animate-preview-in motion-safe:[animation-delay:320ms]">
					<PreviewPost author="Your friend" short />
				</div>
			</div>
		</figure>
	);
}
