import { setIsDebugEnabled } from "@api/settings";
import { PanelSection, PanelSectionRow, ToggleField } from "@decky/ui";
import { showErrorToast } from "@ui/toasts";
import logger from "@utils/logger";
import { type ReactElement, useCallback, useState } from "react";
import { ActivityAccountSettings } from "./components/ActivityAccountSettings";
import { ActivityStatusSettings } from "./components/ActivityStatusSettings";

async function saveDebugSetting(enabled: boolean): Promise<void> {
	try {
		await setIsDebugEnabled(enabled);
	} catch (error: unknown) {
		logger.error("[activity] Could not save debug logging setting", error);

		showErrorToast("Could not save the debug logging setting.");
	}
}

export function ActivitySettings(): ReactElement {
	const [isDebug, setIsDebug] = useState(logger.isDebugEnabled());

	const handleDebugChange = useCallback((enabled: boolean): void => {
		setIsDebug(enabled);
		logger.setDebugEnabled(enabled);

		void saveDebugSetting(enabled);
	}, []);

	return (
		<>
			<ActivityAccountSettings />

			<ActivityStatusSettings />

			<PanelSection title="Advanced">
				<PanelSectionRow>
					<ToggleField
						checked={isDebug}
						description="Verbose logs for bug reports."
						label="Debug logging"
						onChange={handleDebugChange}
					/>
				</PanelSectionRow>
			</PanelSection>
		</>
	);
}
