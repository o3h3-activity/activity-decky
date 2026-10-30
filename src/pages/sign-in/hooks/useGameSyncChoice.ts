import { type GameSyncProgress, syncGames } from "@stores/gameSync";
import { showErrorToast, showSuccessToast } from "@ui/toasts";
import logger from "@utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";

export type GameSyncPhase =
	| Readonly<{ progress: GameSyncProgress; status: "finished" }>
	/** `progress` is undefined while the games on this Deck are still being found. */
	| Readonly<{ progress: GameSyncProgress | undefined; status: "failed" }>
	| Readonly<{ progress: GameSyncProgress | undefined; status: "syncing" }>
	| Readonly<{ status: "choosing" }>;

export type GameSyncChoiceState = Readonly<{
	handleChoice: (isEnabled: boolean) => void;
	isEnabled: boolean;
	phase: GameSyncPhase;
	/** Starts syncing; if the page closes first, the outcome arrives as a toast instead. */
	start: () => void;
}>;

export const GAME_SYNC_FAILED_MESSAGE =
	"Could not finish syncing your games with Activity. The rest sync when you open their pages.";

export function gameSyncResultMessage({
	answered,
	total,
}: GameSyncProgress): string {
	if (total === 0) {
		return "No supported games to sync on this Deck.";
	}

	const games = `${total} ${total === 1 ? "game" : "games"}`;

	if (answered === total) {
		return `Synced ${games} with Activity.`;
	}

	return `Synced ${answered} of ${games} with Activity. The rest sync when you open their pages.`;
}

/** `No` until the user picks; nothing is saved, the choice only decides this one sync. */
export function useGameSyncChoice(): GameSyncChoiceState {
	const [isEnabled, setIsEnabled] = useState(false);
	const [phase, setPhase] = useState<GameSyncPhase>({ status: "choosing" });
	const isShown = useRef(true);

	useEffect(() => {
		isShown.current = true;

		return () => {
			isShown.current = false;
		};
	}, []);

	const handleChoice = useCallback((enabled: boolean): void => {
		setIsEnabled(enabled);
	}, []);

	const start = useCallback((): void => {
		let latest: GameSyncProgress | undefined;

		setPhase({ progress: undefined, status: "syncing" });

		void (async () => {
			try {
				const progress = await syncGames((update) => {
					latest = update;
					setPhase({ progress: update, status: "syncing" });
				});

				setPhase({ progress, status: "finished" });

				if (!isShown.current) {
					showSuccessToast(gameSyncResultMessage(progress));
				}
			} catch (error: unknown) {
				logger.error("[activity] Could not sync games", error);
				setPhase({ progress: latest, status: "failed" });

				if (!isShown.current) {
					showErrorToast(GAME_SYNC_FAILED_MESSAGE);
				}
			}
		})();
	}, []);

	return { handleChoice, isEnabled, phase, start };
}
