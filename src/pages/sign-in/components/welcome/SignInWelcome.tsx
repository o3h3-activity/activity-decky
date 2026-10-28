/* oxlint-disable react/forbid-component-props */
import { PageBody } from "@components/PageBody";
import { PageLayout } from "@components/PageLayout";
import { DialogButton, DialogButtonPrimary, Focusable } from "@decky/ui";
import { useValue } from "@legendapp/state/react";
import { accountStore } from "@stores/account";
import {
	type ReactElement,
	type ReactNode,
	useCallback,
	useState,
} from "react";
import {
	MdArrowBack,
	MdArrowForward,
	MdCheck,
	MdInfoOutline,
} from "react-icons/md";
import { SignInStep } from "../SignInStep";
import { PlayTimeSyncChoice } from "./PlayTimeSyncChoice";
import {
	type PlayTimeSyncChoiceState,
	usePlayTimeSyncChoice,
} from "./usePlayTimeSyncChoice";
import { WelcomeAchievementsPreview } from "./WelcomeAchievementsPreview";
import { WelcomeDesktopPreview } from "./WelcomeDesktopPreview";
import { WelcomeGamePreview } from "./WelcomeGamePreview";
import { WelcomePlayTimePreview } from "./WelcomePlayTimePreview";

const STEPS = [
	"Games",
	"Achievements",
	"Desktop Mode",
	"Sign in",
	"Set up",
] as const;
const SIGN_IN_STEP = 3;
/** Reached only from a sign-in completed on this page. */
const SETUP_STEP = 4;

type SignInWelcomeProps = Readonly<{
	initiallyShowSignIn: boolean;
	onClose: () => void;
}>;

type WelcomeSlide = Readonly<{
	body: ReactNode;
	/** Interactive content between the body and the note. */
	choice?: ReactNode;
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
	{
		body: "View your activity, share comments, and track RetroAchievements on your game’s Steam page in Desktop Mode, too.",
		note: "Set up Activity and manage its Decky settings in Game Mode.",
		preview: <WelcomeDesktopPreview />,
		title: "Your activity, in Desktop Mode too",
	},
];

function renderSlide({
	body,
	choice,
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

				{choice}

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

/** Compact stepper: only the current step shows its label, so it shares one row with the buttons. */
function renderProgress(step: number): ReactElement {
	return (
		<ol
			aria-label="Setup progress"
			className="m-0 flex min-w-0 list-none items-center gap-2 p-0"
		>
			{STEPS.map((label, index) => (
				<li
					aria-current={index === step ? "step" : undefined}
					className="flex items-center gap-2"
					key={label}
				>
					{index > 0 && (
						<span
							aria-hidden="true"
							className={`h-px w-5 ${index <= step ? "bg-[#1a9fff]/60" : "bg-white/15"}`}
						/>
					)}

					<span
						className={`flex items-center gap-2 rounded-full ${index === step ? "bg-[#1a9fff]/15 pr-3" : ""}`}
					>
						<span
							className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${stepMarkerClassName(index, step)}`}
						>
							{index < step ? <MdCheck aria-hidden="true" /> : index + 1}
						</span>

						<span
							className={
								index === step
									? "text-sm font-semibold whitespace-nowrap text-white"
									: "sr-only"
							}
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

	if (step === SETUP_STEP) {
		return "Skip";
	}

	return closes ? "Close" : "Back";
}

function primaryLabel(step: number): string {
	if (step === SETUP_STEP) {
		return "Done";
	}

	return step === SIGN_IN_STEP - 1 ? "Sign in" : "Next";
}

function renderSetupSlide(playTime: PlayTimeSyncChoiceState): ReactElement {
	return renderSlide({
		body: (
			<>
				<span className="font-semibold text-white">PlayTime</span>

				<span>
					{" "}
					already tracks how long you play. Activity can send your finished
					sessions to your Activity profile, so your play time shows up there
					too.
				</span>
			</>
		),
		choice: (
			<PlayTimeSyncChoice
				disabled={playTime.isSaving}
				isEnabled={playTime.isEnabled}
				onChange={playTime.handleChoice}
			/>
		),
		note: "Requires the PlayTime Decky plugin. Nothing is sent unless you choose Yes.",
		preview: <WelcomePlayTimePreview isSharing={playTime.isEnabled} />,
		title: "Share your play time with Activity",
	});
}

export function SignInWelcome({
	initiallyShowSignIn,
	onClose,
}: SignInWelcomeProps): ReactElement {
	const status = useValue(() => accountStore.authorization.get()?.status);
	const [step, setStep] = useState(initiallyShowSignIn ? SIGN_IN_STEP : 0);
	const playTime = usePlayTimeSyncChoice();
	const isSignInStep = step === SIGN_IN_STEP;
	const isSetupStep = step === SETUP_STEP;
	// Once signed in, the slides have nothing left to offer: Back becomes Close, or Skip in setup.
	const closes =
		step === 0 || isSetupStep || (isSignInStep && status === "signedIn");
	const label = backLabel(step, closes);

	const onSignedIn = useCallback((): void => {
		setStep(SETUP_STEP);
	}, []);

	function onBack(): void {
		if (playTime.isSaving) {
			return;
		}

		if (closes) {
			onClose();

			return;
		}

		setStep(step - 1);
	}

	async function finishSetup(): Promise<void> {
		if (await playTime.save()) {
			onClose();
		}
	}

	function onNext(): void {
		if (isSetupStep) {
			void finishSetup();

			return;
		}

		setStep(step + 1);
	}

	function onCancel(event: CustomEvent): void {
		event.stopPropagation();
		onBack();
	}

	function renderStep(): ReactElement {
		if (isSignInStep) {
			return <SignInStep onClose={onClose} onSignedIn={onSignedIn} />;
		}

		if (isSetupStep) {
			return renderSetupSlide(playTime);
		}

		return renderSlide(SLIDES[step]);
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
				<PageBody>{renderStep()}</PageBody>

				<div className="flex items-center justify-between gap-6 border-t border-white/10 pt-4">
					{renderProgress(step)}

					<Focusable
						className="grid shrink-0 auto-cols-[160px] grid-flow-col gap-2"
						flow-children="horizontal"
						focusableIfEmpty
					>
						<DialogButton disabled={playTime.isSaving} onClick={onBack}>
							<span className="flex items-center justify-center gap-2">
								{!closes && <MdArrowBack aria-hidden="true" />}

								{label}
							</span>
						</DialogButton>

						{!isSignInStep && (
							<DialogButtonPrimary
								disabled={playTime.isSaving}
								onClick={onNext}
								// Setup starts on the Yes/No cards instead.
								preferredFocus={!isSetupStep}
							>
								<span className="flex items-center justify-center gap-2">
									{primaryLabel(step)}

									{isSetupStep ? (
										<MdCheck aria-hidden="true" />
									) : (
										<MdArrowForward aria-hidden="true" />
									)}
								</span>
							</DialogButtonPrimary>
						)}
					</Focusable>
				</div>
			</PageLayout>
		</Focusable>
	);
}
