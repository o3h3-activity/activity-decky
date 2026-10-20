/* oxlint-disable no-warning-comments */
import type { SteamClanEvent } from "@typings/activity";

export type AnnouncementQuery = Readonly<{
	appId?: number;
	clanAccountId?: number;
	count?: number;
	endTime?: number;
	startTime?: number;
}>;

/** Source shared by Activity cards and User News announcement events. */
export async function getAnnouncements(
	_query: AnnouncementQuery,
): Promise<readonly SteamClanEvent[] | undefined> {
	// eslint-disable-next-line sonarjs/todo-tag
	// TODO: Fetch editorial announcements by release revision.
	return undefined;
}

/** Source for Steam's single partner-event lookup. */
export async function getAnnouncement(
	_query: AnnouncementQuery,
): Promise<SteamClanEvent | undefined> {
	// eslint-disable-next-line sonarjs/todo-tag
	// TODO: Fetch one editorial announcement by release revision.
	return undefined;
}
