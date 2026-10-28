import { useValue } from "@legendapp/state/react";
import { playTimeSyncStore, savePlayTimeSync } from "@stores/playTimeSync";
import { showErrorToast } from "@ui/toasts";
import logger from "@utils/logger";
import { useCallback, useState } from "react";

export type PlayTimeSyncChoiceState = Readonly<{
	handleChoice: (enabled: boolean) => void;
	isEnabled: boolean;
	isSaving: boolean;
	/** Resolves `false` when saving failed; the user has been told. */
	save: () => Promise<boolean>;
}>;

/** Shows the saved choice (`No` until it loads) until the user picks one. */
export function usePlayTimeSyncChoice(): PlayTimeSyncChoiceState {
	const saved = useValue(playTimeSyncStore.isEnabled);
	const [choice, setChoice] = useState<boolean>();
	const [isSaving, setIsSaving] = useState(false);
	const isEnabled = choice ?? saved ?? false;

	const handleChoice = useCallback((enabled: boolean): void => {
		setChoice(enabled);
	}, []);

	const save = useCallback(async (): Promise<boolean> => {
		setIsSaving(true);

		try {
			await savePlayTimeSync(isEnabled);

			return true;
		} catch (error: unknown) {
			logger.error("[activity] Could not save the PlayTime setting", error);
			showErrorToast("Could not save your PlayTime choice.");

			return false;
		} finally {
			setIsSaving(false);
		}
	}, [isEnabled]);

	return { handleChoice, isEnabled, isSaving, save };
}
