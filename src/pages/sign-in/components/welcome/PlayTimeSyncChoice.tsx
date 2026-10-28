/* oxlint-disable react/forbid-component-props */
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- D-pad focus needs Steam's Focusable, not a native radio input. */
import { Focusable } from "@decky/ui";
import type { ReactElement } from "react";

const OPTIONS = [
	{ description: "Send each finished session", label: "Yes", value: true },
	{ description: "Keep it on this Deck", label: "No", value: false },
] as const;

type PlayTimeSyncChoiceProps = Readonly<{
	disabled: boolean;
	isEnabled: boolean;
	onChange: (enabled: boolean) => void;
}>;

/** Gamepad-friendly Yes/No radio cards: A selects the focused card. */
export function PlayTimeSyncChoice({
	disabled,
	isEnabled,
	onChange,
}: PlayTimeSyncChoiceProps): ReactElement {
	return (
		<div className="flex flex-col gap-2">
			<p
				className="m-0 text-sm leading-5 font-semibold text-white"
				id="play-time-sync-question"
			>
				Use PlayTime to send my play time to Activity?
			</p>

			<Focusable
				aria-labelledby="play-time-sync-question"
				className="grid grid-cols-2 gap-2"
				flow-children="horizontal"
				role="radiogroup"
			>
				{OPTIONS.map(({ description, label, value }) => {
					const isSelected = value === isEnabled;

					return (
						<Focusable
							aria-checked={isSelected}
							aria-disabled={disabled}
							className={`flex items-center gap-3 rounded-md p-3 ring-1 ring-inset transition-colors ${isSelected ? "bg-[#1a9fff]/15 ring-[#1a9fff]" : "bg-white/5 ring-white/10"}`}
							// `!` beats Steam's focus styles, so the D-pad position stays visible.
							focusClassName="bg-white/15! ring-2! ring-white!"
							focusable
							key={label}
							noFocusRing
							onActivate={() => {
								if (!disabled) {
									onChange(value);
								}
							}}
							onOKActionDescription="Select"
							// D-pad users start on the current answer, not on Done.
							preferredFocus={isSelected}
							role="radio"
						>
							<span
								className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${isSelected ? "border-[#1a9fff]" : "border-slate-500"}`}
							>
								{isSelected && (
									<span className="size-2.5 rounded-full bg-[#1a9fff]" />
								)}
							</span>

							<span className="flex min-w-0 flex-col">
								<span className="text-base leading-6 font-semibold text-white">
									{label}
								</span>

								<span className="text-sm leading-5 text-slate-400">
									{description}
								</span>
							</span>
						</Focusable>
					);
				})}
			</Focusable>
		</div>
	);
}
