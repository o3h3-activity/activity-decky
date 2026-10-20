import type {
	ActivityUser,
	DeviceAuthorizationState,
	DeviceAuthorizationStatus,
} from "@api/account";
import { SIGNED_OUT_HINT } from "@components/ActivityAccountCopy";
import { useActivityAccount } from "@components/useActivityAccount";
import {
	ButtonItem,
	ConfirmModal,
	Field,
	PanelSection,
	PanelSectionRow,
	showModal,
} from "@decky/ui";
import { navigateTo, ROUTES } from "@pages/routes";
import { AppActivityStore } from "@steam/proxy/appActivityStore";
import {
	cancelSignIn,
	isSignInInProgress,
	type ProfileStatus,
	refreshActivityAccount,
	reloadProfile,
	signOutOfActivity,
} from "@stores/account";
import { type ReactElement, useEffect } from "react";
import { MdAccountCircle, MdWarning } from "react-icons/md";
import { AccessExpiryField } from "./AccessExpiryField";

type Action = () => void;

type SignedInProps = Readonly<{
	authorization: DeviceAuthorizationState;
	isBusy: boolean;
	profile: ActivityUser | undefined;
	profileStatus: ProfileStatus;
}>;

const ICON_SIZE = 32;
/** Tailwind's amber-400, for icons that take a colour rather than a class. */
const WARNING_COLOR = "#fbbf24";

const SIGNED_OUT_REASONS: Partial<
	Readonly<Record<DeviceAuthorizationStatus, string>>
> = {
	denied: "The last sign-in was denied.",
	expired: "The last sign-in code expired.",
};

function openSignInPage(): void {
	navigateTo(ROUTES.signIn);
}

function retryLoad(): void {
	void refreshActivityAccount();
}

function confirmSignOut(): void {
	showModal(
		<ConfirmModal
			bDestructiveWarning
			onOK={signOutOfActivity}
			strDescription="Activity’s features stop working on this Deck until you sign in again."
			strOKButtonText="Sign out"
			strTitle="Sign out of Activity?"
		/>,
	);
}

function renderButton(
	label: string,
	onClick: Action,
	disabled = false,
): ReactElement {
	return (
		<PanelSectionRow>
			<ButtonItem layout="below" disabled={disabled} onClick={onClick}>
				{label}
			</ButtonItem>
		</PanelSectionRow>
	);
}

function renderField(
	label: string,
	description?: string,
	icon?: ReactElement,
): ReactElement {
	return (
		<PanelSectionRow>
			<Field
				bottomSeparator="none"
				description={description}
				icon={icon}
				label={label}
			/>
		</PanelSectionRow>
	);
}

function renderAvatar(url?: null | string): ReactElement {
	if (typeof url === "string") {
		return (
			<img
				alt=""
				className="size-8 rounded-full object-cover"
				height={ICON_SIZE}
				src={url}
				width={ICON_SIZE}
			/>
		);
	}

	return <MdAccountCircle size={ICON_SIZE} />;
}

function renderProfile(
	profile: ActivityUser | undefined,
	profileStatus: ProfileStatus,
): ReactElement {
	if (profile !== undefined) {
		return renderField(
			profile.nickname,
			"Signed in to Activity",
			renderAvatar(profile.avatarUrl),
		);
	}

	if (profileStatus === "failed") {
		return (
			<>
				{renderField(
					"Signed in to Activity",
					"Couldn’t load your profile.",
					renderAvatar(),
				)}

				{renderButton("Reload profile", reloadProfile)}
			</>
		);
	}

	return renderField("Loading profile…", undefined, renderAvatar());
}

function renderSignedIn({
	authorization,
	isBusy,
	profile,
	profileStatus,
}: SignedInProps): ReactElement {
	const deckSteamId = AppActivityStore.getCurrentUserSteamId();
	const isOtherSteamAccount =
		typeof profile?.steamId === "string" &&
		typeof deckSteamId === "string" &&
		profile.steamId !== deckSteamId;

	return (
		<>
			{renderProfile(profile, profileStatus)}

			{isOtherSteamAccount &&
				renderField(
					"Linked to a different Steam account",
					"Posting comments is disabled. Sign in with the Activity account of this Steam user.",
					<MdWarning color={WARNING_COLOR} size={ICON_SIZE} />,
				)}

			<AccessExpiryField tokenExpiresAt={authorization.tokenExpiresAt} />

			{renderButton("Sign out", confirmSignOut, isBusy)}
		</>
	);
}

function signedOutReason({
	message,
	status,
}: DeviceAuthorizationState): string {
	const reason = SIGNED_OUT_REASONS[status];

	if (reason !== undefined) {
		return reason;
	}

	if (message !== "") {
		return message;
	}

	return SIGNED_OUT_HINT;
}

function renderAuthorization(props: SignedInProps): ReactElement {
	const { authorization, isBusy } = props;

	if (authorization.status === "signedIn") {
		return renderSignedIn(props);
	}

	if (isSignInInProgress(authorization.status)) {
		return (
			<>
				{renderField(
					"Sign-in in progress",
					"Approve this Deck on your phone or another device.",
				)}

				{renderButton("Show sign-in code", openSignInPage)}

				{renderButton("Cancel sign-in", cancelSignIn, isBusy)}
			</>
		);
	}

	return (
		<>
			{renderField("Not signed in", signedOutReason(authorization))}

			{renderButton("Sign in", openSignInPage, isBusy)}
		</>
	);
}

function renderUnloaded(loadError: string | undefined): ReactElement {
	if (loadError === undefined) {
		return renderField("Loading account…");
	}

	return (
		<>
			{renderField("Couldn’t load your Activity account")}

			{renderButton("Retry", retryLoad)}
		</>
	);
}

export function ActivityAccountSettings(): ReactElement {
	const { authorization, isBusy, loadError, profile, profileStatus } =
		useActivityAccount();

	// The backend rechecks token expiry on each read; the cached snapshot renders meanwhile.
	useEffect(() => {
		void refreshActivityAccount();
	}, []);

	const authorizationContent =
		authorization === undefined
			? renderUnloaded(loadError)
			: renderAuthorization({
					authorization,
					isBusy,
					profile,
					profileStatus,
				});

	return (
		<PanelSection
			spinner={authorization === undefined && loadError === undefined}
			title="Account"
		>
			{authorizationContent}
		</PanelSection>
	);
}
