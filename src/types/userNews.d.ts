export type ActivityFeedActor = {
	avatarUrl?: string;
	nickname?: string;
	steamId: string;
};

export type UserNewsEventBase = {
	actor: ActivityFeedActor;
	id: string;
	ownedByCurrentUser: boolean;
	/** Stable Unix timestamp in seconds. */
	rtime: number;
};

/** RetroAchievements ids unlocked at `rtime`. */
export type AchievementUnlockedUserNewsEvent = UserNewsEventBase & {
	achievement_ids: string[];
	kind: "achievement_unlocked";
};

export type PlayedFirstTimeUserNewsEvent = UserNewsEventBase & {
	kind: "played_first_time";
};

export type ReceivedNewGameUserNewsEvent = UserNewsEventBase & {
	kind: "received_new_game";
};

export type UserStatusUserNewsEvent = UserNewsEventBase & {
	kind: "user_status";
	status_text: string;
};

export type UserNewsEvent =
	| AchievementUnlockedUserNewsEvent
	| PlayedFirstTimeUserNewsEvent
	| ReceivedNewGameUserNewsEvent
	| UserStatusUserNewsEvent;

export type ParsedUserNewsFeed = Readonly<{
	events: UserNewsEvent[];
}>;
