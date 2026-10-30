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
	MdSync,
} from "react-icons/md";
import { SignInStep } from "../SignInStep";
import { GameSyncStatus } from "./GameSyncStatus";
import {
	type GameSyncChoiceState,
	useGameSyncChoice,
} from "./useGameSyncChoice";
import {
	type PlayTimeSyncChoiceState,
	usePlayTimeSyncChoice,
} from "./usePlayTimeSyncChoice";
import { WelcomeAchievementsPreview } from "./WelcomeAchievementsPreview";
import { WelcomeDesktopPreview } from "./WelcomeDesktopPreview";
import { WelcomeGamePreview } from "./WelcomeGamePreview";
import { WelcomeGameSyncPreview } from "./WelcomeGameSyncPreview";
import { WelcomePlayTimePreview } from "./WelcomePlayTimePreview";
import { YesNoChoice } from "./YesNoChoice";

const STEPS = [
	"Games",
	"Achievements",
	"Desktop Mode",
	"Sign in",
	"PlayTime",
	"Sync games",
] as const;
const SIGN_IN_STEP = 3;
/** Setup steps are reached only from a sign-in completed on this page. */
const PLAY_TIME_STEP = 4;
const GAME_SYNC_STEP = 5;

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

	if (step >= PLAY_TIME_STEP) {
		return "Skip";
	}

	return closes ? "Close" : "Back";
}

/** Whether Done on the last step starts syncing instead of closing. */
function startsGameSync(gameSync: GameSyncChoiceState): boolean {
	return gameSync.phase.status === "choosing" && gameSync.isEnabled;
}

function primaryLabel(step: number, gameSync: GameSyncChoiceState): string {
	if (step !== GAME_SYNC_STEP) {
		return step === SIGN_IN_STEP - 1 ? "Sign in" : "Next";
	}

	if (gameSync.phase.status === "syncing") {
		return "Syncing…";
	}

	return startsGameSync(gameSync) ? "Sync games" : "Done";
}

function renderPrimaryIcon(
	step: number,
	gameSync: GameSyncChoiceState,
): ReactElement | undefined {
	if (step !== GAME_SYNC_STEP) {
		return <MdArrowForward aria-hidden="true" />;
	}

	if (gameSync.phase.status === "syncing") {
		return undefined;
	}

	return startsGameSync(gameSync) ? (
		<MdSync aria-hidden="true" />
	) : (
		<MdCheck aria-hidden="true" />
	);
}

function renderPlayTimeSlide(playTime: PlayTimeSyncChoiceState): ReactElement {
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
			<YesNoChoice
				disabled={playTime.isSaving}
				id="play-time-sync-question"
				noDescription="Keep it on this Deck"
				onChange={playTime.handleChoice}
				question="Use PlayTime to send my play time to Activity?"
				value={playTime.isEnabled}
				yesDescription="Send each finished session"
			/>
		),
		note: "Requires the PlayTime Decky plugin. Nothing is sent unless you choose Yes.",
		preview: <WelcomePlayTimePreview isSharing={playTime.isEnabled} />,
		title: "Share your play time with Activity",
	});
}

function renderGameSyncSlide(gameSync: GameSyncChoiceState): ReactElement {
	return renderSlide({
		body: "Activity recognizes each game the first time you open it. It can recognize every supported game on this Deck right now instead, so their activity and RetroAchievements are ready from the start.",
		choice:
			gameSync.phase.status === "choosing" ? (
				<YesNoChoice
					disabled={false}
					id="game-sync-question"
					noDescription="As I open each game"
					onChange={gameSync.handleChoice}
					question="Sync the games on this Deck with Activity?"
					value={gameSync.isEnabled}
					yesDescription="Recognize them all now"
				/>
			) : (
				<GameSyncStatus phase={gameSync.phase} />
			),
		note: "Games that aren’t recognized now still sync when you open their pages.",
		preview: <WelcomeGameSyncPreview isSyncing={gameSync.isEnabled} />,
		title: "Sync your games with Activity",
	});
}

export function SignInWelcome({
	initiallyShowSignIn,
	onClose,
}: SignInWelcomeProps): ReactElement {
	const status = useValue(() => accountStore.authorization.get()?.status);
	const [step, setStep] = useState(initiallyShowSignIn ? SIGN_IN_STEP : 0);
	const playTime = usePlayTimeSyncChoice();
	const gameSync = useGameSyncChoice();
	const isSignInStep = step === SIGN_IN_STEP;
	const isSetupStep = step >= PLAY_TIME_STEP;
	const isSyncingGames = gameSync.phase.status === "syncing";
	// Once a sync starts there is nothing to skip; Done appears when it ends.
	const hasStartedGameSync =
		step === GAME_SYNC_STEP && gameSync.phase.status !== "choosing";
	const isBusy = playTime.isSaving || isSyncingGames;
	// Once signed in, the slides have nothing left to offer: Back becomes Close, or Skip in setup.
	const closes =
		step === 0 ||
		step === GAME_SYNC_STEP ||
		(isSignInStep && status === "signedIn");
	const label = backLabel(step, closes);

	const onSignedIn = useCallback((): void => {
		setStep(PLAY_TIME_STEP);
	}, []);

	function onBack(): void {
		if (isBusy) {
			return;
		}

		if (closes) {
			onClose();

			return;
		}

		setStep(step === PLAY_TIME_STEP ? GAME_SYNC_STEP : step - 1);
	}

	async function finishPlayTime(): Promise<void> {
		if (await playTime.save()) {
			setStep(GAME_SYNC_STEP);
		}
	}

	function onNext(): void {
		if (step === PLAY_TIME_STEP) {
			void finishPlayTime();

			return;
		}

		if (step === GAME_SYNC_STEP) {
			if (startsGameSync(gameSync)) {
				gameSync.start();
			} else {
				onClose();
			}

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

		if (step === PLAY_TIME_STEP) {
			return renderPlayTimeSlide(playTime);
		}

		if (step === GAME_SYNC_STEP) {
			return renderGameSyncSlide(gameSync);
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
						{!hasStartedGameSync && (
							<DialogButton disabled={isBusy} onClick={onBack}>
								<span className="flex items-center justify-center gap-2">
									{!closes && !isSetupStep && (
										<MdArrowBack aria-hidden="true" />
									)}

									{label}
								</span>
							</DialogButton>
						)}

						{!isSignInStep && (
							<DialogButtonPrimary
								disabled={isBusy}
								onClick={onNext}
								// Setup starts on the Yes/No cards, and a running sync on its status, instead.
								preferredFocus={
									!isSetupStep || (hasStartedGameSync && !isSyncingGames)
								}
							>
								<span className="flex items-center justify-center gap-2">
									{primaryLabel(step, gameSync)}

									{renderPrimaryIcon(step, gameSync)}
								</span>
							</DialogButtonPrimary>
						)}
					</Focusable>
				</div>
			</PageLayout>
		</Focusable>
	);
}
