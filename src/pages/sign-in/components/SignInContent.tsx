/* oxlint-disable react/forbid-component-props */
import type { ActivityUser, DeviceAuthorizationState } from "@api/account";
import { SIGNED_OUT_HINT } from "@components/ActivityAccountCopy";
import { DialogBodyText, DialogButton, Spinner } from "@decky/ui";
import type { ReactElement } from "react";
import { FocusableButtonRow } from "./FocusableButtonRow";
import { PendingSignIn } from "./PendingSignIn";

type Action = () => void;

type SignInContentProps = Readonly<{
	authorization: DeviceAuthorizationState | undefined;
	hasWitnessedSignIn: boolean;
	isBusy: boolean;
	/** The page has refreshed the account and decided whether to start a sign-in. */
	isReady: boolean;
	loadError: string | undefined;
	onCancel: Action;
	onClose: Action;
	onRetryLoad: Action;
	onStart: Action;
	profile: ActivityUser | undefined;
}>;

type ActiveSignInContentProps = Readonly<
	Omit<SignInContentProps, "authorization"> & {
		authorization: DeviceAuthorizationState;
	}
>;

function renderProgress(text: string): ReactElement {
	return (
		<div className="flex items-center gap-3">
			<span className="inline-flex size-6 [&>svg]:size-full">
				<Spinner />
			</span>

			<DialogBodyText>{text}</DialogBodyText>
		</div>
	);
}

function renderLoadError(message: string, onRetryLoad: Action): ReactElement {
	return (
		<>
			<DialogBodyText>{message}</DialogBodyText>

			<FocusableButtonRow>
				<DialogButton onClick={onRetryLoad}>Retry</DialogButton>
			</FocusableButtonRow>
		</>
	);
}

function renderStarting(isBusy: boolean, onCancel: Action): ReactElement {
	return (
		<>
			{renderProgress("Requesting a sign-in code…")}

			<FocusableButtonRow>
				<DialogButton disabled={isBusy} onClick={onCancel}>
					Cancel
				</DialogButton>
			</FocusableButtonRow>
		</>
	);
}

function renderSignedIn({
	hasWitnessedSignIn,
	isBusy,
	onClose,
	profile,
}: ActiveSignInContentProps): ReactElement {
	let account = "to Activity";

	if (profile !== undefined) {
		account = `as ${profile.nickname}`;
	}

	const message = hasWitnessedSignIn
		? `You’re signed in ${account}. This screen closes in a moment.`
		: `You’re already signed in ${account}.`;

	return (
		<>
			<DialogBodyText>{message}</DialogBodyText>

			<FocusableButtonRow>
				<DialogButton disabled={isBusy} onClick={onClose}>
					Close
				</DialogButton>
			</FocusableButtonRow>
		</>
	);
}

function renderTerminal(
	message: string,
	{ isBusy, onClose, onStart }: ActiveSignInContentProps,
): ReactElement {
	return (
		<>
			<DialogBodyText>{message}</DialogBodyText>

			<FocusableButtonRow>
				<DialogButton disabled={isBusy} onClick={onStart}>
					Try again
				</DialogButton>

				<DialogButton disabled={isBusy} onClick={onClose}>
					Close
				</DialogButton>
			</FocusableButtonRow>
		</>
	);
}

function renderSignedOut({
	authorization,
	isBusy,
	onStart,
}: ActiveSignInContentProps): ReactElement {
	let message = authorization.message;

	if (message === "") {
		message = SIGNED_OUT_HINT;
	}

	return (
		<>
			<DialogBodyText>{message}</DialogBodyText>

			<FocusableButtonRow>
				<DialogButton disabled={isBusy} onClick={onStart}>
					Sign in
				</DialogButton>
			</FocusableButtonRow>
		</>
	);
}

function renderActiveState(props: ActiveSignInContentProps): ReactElement {
	const { authorization, isBusy, onCancel } = props;

	switch (authorization.status) {
		case "starting": {
			return renderStarting(isBusy, onCancel);
		}

		case "pending": {
			return (
				<PendingSignIn
					isBusy={isBusy}
					onCancel={onCancel}
					state={authorization}
				/>
			);
		}

		case "signedIn": {
			return renderSignedIn(props);
		}

		case "denied": {
			return renderTerminal("Sign-in was denied.", props);
		}

		case "expired": {
			return renderTerminal("The sign-in code expired.", props);
		}

		case "error": {
			return renderTerminal(authorization.message, props);
		}

		case "signedOut": {
			return renderSignedOut(props);
		}

		default: {
			return renderProgress("Loading…");
		}
	}
}

export function SignInContent(props: SignInContentProps): ReactElement {
	const { authorization, isBusy, isReady, loadError, onRetryLoad } = props;

	if (!isReady || authorization === undefined) {
		if (loadError === undefined) {
			return renderProgress("Loading…");
		}

		return renderLoadError(loadError, onRetryLoad);
	}

	// A start request is in flight; the backend's `starting` snapshot follows.
	if (
		isBusy &&
		authorization.status !== "signedIn" &&
		authorization.status !== "pending"
	) {
		return renderProgress("Requesting a sign-in code…");
	}

	return renderActiveState({ ...props, authorization });
}
