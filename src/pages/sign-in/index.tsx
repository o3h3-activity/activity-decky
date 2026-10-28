import type { DeviceAuthorizationStatus } from "@api/account";
import { Navigation } from "@decky/ui";
import { accountStore } from "@stores/account";
import type { ReactElement } from "react";
import { SignInStep } from "./components/SignInStep";
import { SignInWelcome } from "./components/welcome/SignInWelcome";

function onClose(): void {
	Navigation.NavigateBack();
}

function skipsWelcome(status: DeviceAuthorizationStatus | undefined): boolean {
	return status !== undefined && status !== "signedOut";
}

export function SignInPage(): ReactElement {
	return (
		<div className="flex h-full flex-col">
			<SignInWelcome
				initiallyShowSignIn={skipsWelcome(
					accountStore.authorization.peek()?.status,
				)}
				onClose={onClose}
			>
				<SignInStep onClose={onClose} />
			</SignInWelcome>
		</div>
	);
}
