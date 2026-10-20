import { getAnnouncements } from "@steam/patches/eventsAndAnnouncements/announcementSource";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import logger from "@utils/logger";
import { UserNewsRequests } from "../rpc/userNewsRequests";
import { SteamUserNewsEventType } from "./steamUserNewsEventType";
import type {
	UserNewsEventContext,
	UserNewsEventResult,
	UserNewsRequest,
} from "./types";
import { createUserNewsEventResult } from "./userNewsEventResult";

export class AnnouncementUserNewsEventHandler {
	constructor(private readonly shortcutClans: ShortcutClanRegistry) {}

	registerShortcutApp(appId: number): void {
		this.shortcutClans.registerApp(appId);
	}

	async create(
		request: UserNewsRequest,
		context: UserNewsEventContext,
	): Promise<UserNewsEventResult[]> {
		this.registerShortcutApp(context.appId);

		try {
			const events = await getAnnouncements({
				appId: context.appId,
				count: request.count,
				endTime: request.endTime,
				startTime: request.startTime,
			});

			if (events === undefined) {
				return [];
			}

			return events
				.filter((event) =>
					UserNewsRequests.isWithinWindow(request, event.rtime32_start_time),
				)
				.map((event) =>
					createUserNewsEventResult(context, {
						actorSteamId: event.clan_steamid,
						eventTime: event.rtime32_start_time,
						eventType: SteamUserNewsEventType.Announcement,
						fields: {
							clan_announcementid: event.announcement_body.gid,
							event_last_mod_time: event.rtime32_last_modified,
							event_post_time: event.rtime32_start_time,
						},
					}),
				);
		} catch (error) {
			logger.error("[UserNews][Announcements] Source request failed.", {
				appId: context.appId,
				error,
			});

			return [];
		}
	}
}
