/* oxlint-disable react/forbid-component-props */
import { PageBody } from "@components/PageBody";
import { PageLayout } from "@components/PageLayout";
import { useActivityAccount } from "@components/useActivityAccount";
import { WelcomeAchievementsPreview } from "@components/WelcomeAchievementsPreview";
import { WelcomeGamePreview } from "@components/WelcomeGamePreview";
import { DialogButton, DialogButtonPrimary, Focusable } from "@decky/ui";
import { type ReactElement, type ReactNode, useState } from "react";
import {
	MdArrowBack,
	MdArrowForward,
	MdCheck,
	MdInfoOutline,
} from "react-icons/md";

const STEPS = ["Games", "Achievements", "Sign in"] as const;
const SIGN_IN_STEP = STEPS.length - 1;

type SignInWelcomeProps = Readonly<{
	children: ReactNode;
	initiallyShowSignIn: boolean;
	onClose: () => void;
}>;

type WelcomeSlide = Readonly<{
	body: ReactNode;
	note: string;
	preview: ReactElement;
	title: string;
}>;

/** One slide per step before `SIGN_IN_STEP`. */
const SLIDES: readonly WelcomeSlide[] = [
	{
		body: "See what your friends have been playing, share comments, and follow your RetroAchievements progress, right on the game’s Steam page.",
		note: "Supports PlayStation, PlayStation 2, and PSP games.",
		preview: <WelcomeGamePreview />,
		title: "Steam social features for your non-Steam games",
	},
	{
		body: (
			<>
				<span>Track your progress in the </span>

				<span className="font-semibold text-white">Your Stuff</span>

				<span> tab, and see the achievements you’ve earned in the </span>

				<span className="font-semibold text-white">Activity</span>

				<span> feed.</span>
			</>
		),
		note: "Requires a RetroAchievements account linked to Activity.",
		preview: <WelcomeAchievementsPreview />,
		title: "Your RetroAchievements are back",
	},
];

function renderSlide({
	body,
	note,
	preview,
	title,
}: WelcomeSlide): ReactElement {
	return (
		<section
			aria-labelledby="welcome-step-title"
			className="grid grid-cols-[minmax(0,1fr)_360px] items-center gap-10"
		>
			<div className="flex flex-col gap-4">
				<h2
					className="m-0 flex min-h-18 items-end text-[28px] leading-9 font-bold text-balance text-white"
					id="welcome-step-title"
				>
					{title}
				</h2>

				<p className="m-0 text-base leading-6 text-pretty text-slate-300">
					{body}
				</p>

				<p className="m-0 flex items-center gap-2 text-sm leading-5 text-slate-400">
					<MdInfoOutline aria-hidden="true" className="shrink-0" />

					{note}
				</p>
			</div>

			{/* Tallest preview's height: switching previews must not shift the copy beside them. */}
			<div className="flex min-h-[340px] flex-col items-center justify-center [&>figure]:shadow-[0_12px_40px_#00000040] [&>figure]:ring-1 [&>figure]:ring-white/10">
				{preview}
			</div>
		</section>
	);
}

function stepMarkerClassName(index: number, step: number): string {
	if (index === step) {
		return "bg-[#1a9fff] text-white";
	}

	if (index < step) {
		return "bg-[#1a9fff]/25 text-sky-200";
	}

	return "bg-white/10 text-slate-400";
}

function renderProgress(step: number): ReactElement {
	return (
		<ol
			aria-label="Setup progress"
			className="m-0 flex list-none items-center gap-3 p-0"
		>
			{STEPS.map((label, index) => (
				<li
					aria-current={index === step ? "step" : undefined}
					className="flex items-center gap-3"
					key={label}
				>
					{index > 0 && (
						<span
							aria-hidden="true"
							className={`h-px w-6 ${index <= step ? "bg-[#1a9fff]/60" : "bg-white/15"}`}
						/>
					)}

					<span className="flex items-center gap-2">
						<span
							className={`flex size-6 items-center justify-center rounded-full text-xs font-bold ${stepMarkerClassName(index, step)}`}
						>
							{index < step ? <MdCheck aria-hidden="true" /> : index + 1}
						</span>

						<span
							className={`text-sm ${index === step ? "font-semibold text-white" : "text-slate-400"}`}
						>
							{label}
						</span>
					</span>
				</li>
			))}
		</ol>
	);
}

function backLabel(step: number, closes: boolean): string {
	if (step === 0) {
		return "Not now";
	}

	return closes ? "Close" : "Back";
}

export function SignInWelcome({
	children,
	initiallyShowSignIn,
	onClose,
}: SignInWelcomeProps): ReactElement {
	const { authorization } = useActivityAccount();
	const [step, setStep] = useState(initiallyShowSignIn ? SIGN_IN_STEP : 0);
	const isSignInStep = step === SIGN_IN_STEP;
	// Once signed in, the slides have nothing left to offer: Back becomes Close.
	const closes =
		step === 0 || (isSignInStep && authorization?.status === "signedIn");
	const label = backLabel(step, closes);

	function onBack(): void {
		if (closes) {
			onClose();

			return;
		}

		setStep(step - 1);
	}

	function onNext(): void {
		setStep(step + 1);
	}

	function onCancel(event: CustomEvent): void {
		event.stopPropagation();
		onBack();
	}

	return (
		<Focusable
			className="h-full"
			flow-children="vertical"
			focusableIfEmpty
			onCancel={onCancel}
			onCancelActionDescription={label}
		>
			<PageLayout>
				<PageBody>
					{isSignInStep ? children : renderSlide(SLIDES[step])}
				</PageBody>

				<div className="flex items-center justify-between gap-6 border-t border-white/10 pt-4">
					{renderProgress(step)}

					<Focusable
						className="grid shrink-0 auto-cols-[160px] grid-flow-col gap-2"
						flow-children="horizontal"
						focusableIfEmpty
					>
						<DialogButton onClick={onBack}>
							<span className="flex items-center justify-center gap-2">
								{!closes && <MdArrowBack aria-hidden="true" />}

								{label}
							</span>
						</DialogButton>

						{!isSignInStep && (
							<DialogButtonPrimary onClick={onNext} preferredFocus>
								<span className="flex items-center justify-center gap-2">
									{step === SIGN_IN_STEP - 1 ? "Sign in" : "Next"}

									<MdArrowForward aria-hidden="true" />
								</span>
							</DialogButtonPrimary>
						)}
					</Focusable>
				</div>
			</PageLayout>
		</Focusable>
	);
}
