import { Field, PanelSection, PanelSectionRow } from "@decky/ui";
import { useSelector } from "@legendapp/state/react";
import { accountStore } from "@stores/account";
import {
	type DiscDetectionStatus,
	discDetectionStore,
} from "@stores/discDetection";
import type { ReactElement } from "react";
import { retroAchievementsRow, type StatusRow } from "./activityStatus";

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
	const authorization = useSelector(() => accountStore.authorization.get());
	const discDetection = useSelector(() => discDetectionStore.status.get());
	const loadError = useSelector(() => accountStore.loadError.get());

	return (
		<PanelSection title="Status">
			{renderStatus("Disc game detection", DISC_DETECTION[discDetection])}

			{renderStatus(
				"RetroAchievements",
				retroAchievementsRow(authorization, loadError),
			)}
		</PanelSection>
	);
}
