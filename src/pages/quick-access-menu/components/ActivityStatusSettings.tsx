import { Field, PanelSection, PanelSectionRow, ToggleField } from "@decky/ui";
import { useValue } from "@legendapp/state/react";
import { accountStore } from "@stores/account";
import {
	type DiscDetectionStatus,
	discDetectionStore,
} from "@stores/discDetection";
import { playTimeSyncStore, savePlayTimeSync } from "@stores/playTimeSync";
import { showErrorToast } from "@ui/toasts";
import logger from "@utils/logger";
import { type ReactElement, useState } from "react";
import {
	playTimeSyncRow,
	retroAchievementsRow,
	type StatusRow,
} from "./activityStatus";

const DISC_DETECTION: Readonly<Record<DiscDetectionStatus, StatusRow>> = {
	available: { value: "Available" },
	checking: { value: "Checking…" },
	unavailable: {
		description:
			"RetroAchievements for PS1, PS2 and PSP disc images won’t load.",
		value: "Unavailable",
	},
};

function renderStatus(
	label: string,
	{ description, value }: StatusRow,
): ReactElement {
	return (
		<PanelSectionRow>
			<Field bottomSeparator="none" description={description} label={label}>
				{value}
			</Field>
		</PanelSectionRow>
	);
}

/** What works on this Deck right now, beyond the account itself. */
export function ActivityStatusSettings(): ReactElement {
	const authorization = useValue(accountStore.authorization);
	const discDetection = useValue(discDetectionStore.status);
	const loadError = useValue(accountStore.loadError);
	const isPlayTimeSyncEnabled = useValue(playTimeSyncStore.isEnabled);
	const [isSavingPlayTimeSync, setIsSavingPlayTimeSync] = useState(false);
	const playTimeStatus = playTimeSyncRow(isPlayTimeSyncEnabled);
	const isSignedIn = authorization?.status === "signedIn";

	async function handlePlayTimeChange(enabled: boolean): Promise<void> {
		setIsSavingPlayTimeSync(true);

		try {
			await savePlayTimeSync(enabled);
		} catch (error: unknown) {
			logger.error("[activity] Could not save the PlayTime setting", error);
			showErrorToast("Could not save your PlayTime choice.");
		} finally {
			setIsSavingPlayTimeSync(false);
		}
	}

	return (
		<PanelSection title="Status">
			{renderStatus("Disc game detection", DISC_DETECTION[discDetection])}

			{renderStatus(
				"RetroAchievements",
				retroAchievementsRow(authorization, loadError),
			)}

			{isSignedIn && (
				<PanelSectionRow>
					<ToggleField
						checked={isPlayTimeSyncEnabled === true}
						description={playTimeStatus.description ?? playTimeStatus.value}
						disabled={
							isPlayTimeSyncEnabled === undefined || isSavingPlayTimeSync
						}
						label="PlayTime integration"
						onChange={(enabled) => {
							void handlePlayTimeChange(enabled);
						}}
					/>
				</PanelSectionRow>
			)}
		</PanelSection>
	);
}
