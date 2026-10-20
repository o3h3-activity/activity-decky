import type { ActivityUser, DeviceAuthorizationState } from "@api/account";
import { useSelector } from "@legendapp/state/react";
import { accountStore, type ProfileStatus } from "@stores/account";

export type ActivityAccountView = Readonly<{
	authorization: DeviceAuthorizationState | undefined;
	isBusy: boolean;
	loadError: string | undefined;
	profile: ActivityUser | undefined;
	profileStatus: ProfileStatus;
}>;

/** Re-renders on every change to the plugin-wide Activity account store. */
export function useActivityAccount(): ActivityAccountView {
	const authorization = useSelector(() => accountStore.authorization.get());
	const isBusy = useSelector(() => accountStore.isBusy.get());
	const loadError = useSelector(() => accountStore.loadError.get());
	const profile = useSelector(() => accountStore.profile.get());
	const profileStatus = useSelector(() => accountStore.profileStatus.get());

	return { authorization, isBusy, loadError, profile, profileStatus };
}
