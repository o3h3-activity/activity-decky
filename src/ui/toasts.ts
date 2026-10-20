import { toaster } from "@decky/api";

const TOAST_TITLE = "Activity";
const ERROR_TITLE = "Activity — Error";
const SIGN_IN_TOAST_INTERVAL_MS = 30_000;
let lastSignInToastAt = Number.NEGATIVE_INFINITY;

export function showSuccessToast(body: string): void {
	toaster.toast({ title: TOAST_TITLE, body });
}

export function showErrorToast(body: string): void {
	toaster.toast({ title: ERROR_TITLE, body });
}

/**
 * Drop duplicate login prompts across all API callers; suppressed prompts do not extend the window.
 * Selecting the toast runs `onSelect`, which should open the sign-in page.
 */
export function showSignInRequiredToast(onSelect: () => void): void {
	const now = performance.now();

	if (now - lastSignInToastAt < SIGN_IN_TOAST_INTERVAL_MS) {
		return;
	}

	lastSignInToastAt = now;

	toaster.toast({
		title: TOAST_TITLE,
		body: "Sign in to use Activity’s features. Select to sign in.",
		onClick: onSelect,
	});
}
