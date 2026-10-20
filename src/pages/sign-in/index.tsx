import type { DeviceAuthorizationStatus } from "@api/account";
import { PageLayout } from "@components/PageLayout";
import { useActivityAccount } from "@components/useActivityAccount";
import { Navigation } from "@decky/ui";
import {
	cancelSignIn,
	isSignInInProgress,
	refreshActivityAccount,
	startSignIn,
} from "@stores/account";
import {
	type ReactElement,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { SignInContent } from "./components/SignInContent";

const AUTO_START_STATUSES: Partial<
	Readonly<Record<DeviceAuthorizationStatus, true>>
> = {
	denied: true,
	error: true,
	expired: true,
	signedOut: true,
};

/** Long enough to read the confirmation, short enough not to wait on it. */
const AUTO_CLOSE_MS = 3500;

function onClose(): void {
	Navigation.NavigateBack();
}

/** Refreshes the account, then starts a sign-in unless one is running or the user is signed in. */
function useAutoStart(): Readonly<{ isReady: boolean; prepare: () => void }> {
	const [isReady, setIsReady] = useState(false);
	const requestId = useRef(0);

	const prepare = useCallback((): void => {
		const request = ++requestId.current;

		void (async () => {
			const current = await refreshActivityAccount();

			if (requestId.current !== request) {
				return;
			}

			if (
				current !== undefined &&
				AUTO_START_STATUSES[current.status] === true
			) {
				startSignIn();
			}

			setIsReady(current !== undefined);
		})();
	}, []);

	useEffect(() => {
		prepare();

		return () => {
			requestId.current += 1;
		};
	}, [prepare]);

	return { isReady, prepare };
}

export function SignInPage(): ReactElement {
	const { authorization, isBusy, loadError, profile } = useActivityAccount();
	const { isReady, prepare } = useAutoStart();
	const [hasWitnessedSignIn, setHasWitnessedSignIn] = useState(false);
	const status = authorization?.status;

	useEffect(() => {
		if (isSignInInProgress(status)) {
			// oxlint-disable-next-line react/set-state-in-effect
			setHasWitnessedSignIn(true);
		}
	}, [status]);

	useEffect(() => {
		if (!hasWitnessedSignIn || status !== "signedIn") {
			return;
		}

		const timer = setTimeout(onClose, AUTO_CLOSE_MS);

		return () => clearTimeout(timer);
	}, [hasWitnessedSignIn, status]);

	const onCancelPage = useCallback((): void => {
		cancelSignIn();
		Navigation.NavigateBack();
	}, []);

	return (
		<PageLayout title="Sign in to Activity">
			<SignInContent
				authorization={authorization}
				hasWitnessedSignIn={hasWitnessedSignIn}
				isBusy={isBusy}
				isReady={isReady}
				loadError={loadError}
				onCancel={onCancelPage}
				onClose={onClose}
				onRetryLoad={prepare}
				onStart={startSignIn}
				profile={profile}
			/>
		</PageLayout>
	);
}
