import { observable } from "@legendapp/state";

/** Whether the bundled game-anatomy extension can hash disc images for RetroAchievements. */
export type DiscDetectionStatus = "available" | "checking" | "unavailable";

export const discDetectionStore = observable<{ status: DiscDetectionStatus }>({
	status: "checking",
});
