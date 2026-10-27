import "@decky/ui/dist/components/Focusable";

/**
 * Steam's `Focusable` navigation props that Decky's declaration omits; Decky passes them through.
 */
declare module "@decky/ui/dist/components/Focusable" {
	interface FocusableProps {
		/**
		 * When the focused descendant unmounts, focus moves to another descendant instead of
		 * blurring, so the gamepad never ends up with nothing focused.
		 */
		focusableIfEmpty?: boolean;
	}
}
