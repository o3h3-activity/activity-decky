import type { ActivityUser, DeviceAuthorizationState } from "@api/account";
import { useValue } from "@legendapp/state/react";
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
	const authorization = useValue(accountStore.authorization);
	const isBusy = useValue(accountStore.isBusy);
	const loadError = useValue(accountStore.loadError);
	const profile = useValue(accountStore.profile);
	const profileStatus = useValue(accountStore.profileStatus);

	return { authorization, isBusy, loadError, profile, profileStatus };
}
