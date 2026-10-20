/* oxlint-disable react/forbid-component-props */
import type { DeviceAuthorizationState } from "@api/account";
import { DialogButton } from "@decky/ui";
import type { ReactElement } from "react";
import { ActivitySettingsQrCode } from "./ActivitySettingsQrCode";
import { FocusableButtonRow } from "./FocusableButtonRow";
import { WaitingForApproval } from "./WaitingForApproval";

type Action = () => void;

type PendingSignInProps = Readonly<{
	isBusy: boolean;
	onCancel: Action;
	state: DeviceAuthorizationState;
}>;

function accessTokensCodeUrl(
	accessTokensUrl: string,
	userCode: string,
): string {
	return `${accessTokensUrl}?code=${encodeURIComponent(userCode)}`;
}

/** The URL as a person types it: no scheme, no trailing slash. */
function displayUrl(url: string): string {
	return url.replace(/^https?:\/\//u, "").replace(/\/$/u, "");
}

export function PendingSignIn({
	isBusy,
	onCancel,
	state,
}: PendingSignInProps): ReactElement {
	const qrUrl = accessTokensCodeUrl(state.accessTokensUrl, state.userCode);

	return (
		<>
			<div className="flex items-center gap-6">
				<div className="w-[180px] shrink-0">
					<ActivitySettingsQrCode url={qrUrl} />
				</div>

				<div className="flex min-w-0 flex-col gap-3">
					<div className="text-lg font-bold">
						Scan the QR code with your phone to approve this Deck.
					</div>

					<div className="opacity-80">
						{"Or open "}

						<span className="font-bold break-all">
							{displayUrl(state.accessTokensUrl)}
						</span>{" "}
						on another device and enter this code:
					</div>

					<div className="text-4xl font-bold tracking-widest">
						{state.userCode}
					</div>

					<WaitingForApproval codeExpiresAt={state.codeExpiresAt} />

					{state.message !== "" && (
						<div className="text-amber-400">{state.message}</div>
					)}
				</div>
			</div>

			<FocusableButtonRow>
				<DialogButton disabled={isBusy} onClick={onCancel}>
					Cancel
				</DialogButton>
			</FocusableButtonRow>
		</>
	);
}
