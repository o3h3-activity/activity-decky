import type { DeviceAuthorizationStatus } from "@api/account";
import { useValue } from "@legendapp/state/react";
import {
	accountStore,
	cancelSignIn,
	isSignInInProgress,
	refreshActivityAccount,
	startSignIn,
} from "@stores/account";
import { isNil } from "es-toolkit";
import {
	type ReactElement,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { SignInContent } from "./SignInContent";

const AUTO_START_STATUSES: Partial<
	Readonly<Record<DeviceAuthorizationStatus, true>>
> = {
	denied: true,
	error: true,
	expired: true,
	signedOut: true,
};

const AUTO_CLOSE_MS = 3500;

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

			if (!isNil(current) && AUTO_START_STATUSES[current.status] === true) {
				startSignIn();
			}

			setIsReady(!isNil(current));
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

export function SignInStep({
	onClose,
}: Readonly<{ onClose: () => void }>): ReactElement {
	const authorization = useValue(accountStore.authorization);
	const isBusy = useValue(accountStore.isBusy);
	const loadError = useValue(accountStore.loadError);
	const profile = useValue(accountStore.profile);
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
	}, [hasWitnessedSignIn, onClose, status]);

	const onCancelPage = useCallback((): void => {
		cancelSignIn();
		onClose();
	}, [onClose]);

	return (
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
	);
}
