/**
 * Steam `EProtoClanEventType` from `steammessages_base.proto`.
 * Activity-tab card picker (`we`): type 14 → large image, type 12 → text-only,
 * everything else → medium image. Artwork types still ask StoreBrowse for a
 * screenshot fallback when `jsondata` has no http capsule/title image.
 */
export enum SteamClanEventType {
	/** `k_EClanSmallUpdateEvent`. Text-only card (`PartnerEventTextOnly`). */
	SmallUpdate = 12,
	/** `k_EClanPreAnnounceMajorUpdateEvent`. Medium capsule card. */
	PreAnnounceMajorUpdate = 13,
	/** `k_EClanMajorUpdateEvent`. Large major-update card. */
	MajorUpdate = 14,
	/** `k_EClanNewsEvent`. Medium capsule card (same layout as 13). */
	News = 28,
}

/** Steam's nested `CCommunity_ClanAnnouncementInfo` message. */
export type SteamAnnouncementBody = {
	ban_check_result: number;
	banned: 0 | 1;
	body: string;
	clanid: string;
	commentcount: number;
	event_gid: string;
	forum_topic_id: string;
	gid: string;
	headline: string;
	hidden: 0 | 1;
	language: number;
	posterid: string;
	posttime: number;
	tags: string[];
	updatetime: number;
	votedowncount: number;
	voteupcount: number;
};

/** Steam's `CClanEventData` message plus fields observed in its JSON response. */
export type SteamClanEvent = {
	announcement_body: SteamAnnouncementBody;
	announcement_gid: string;
	appid: number;
	broadcaster_accountid: number;
	build_branch: string;
	build_id: number;
	clan_steamid: string;
	clan_steamid_original: string;
	comment_count: number;
	comment_type: string;
	creator_steamid: string;
	event_name: string;
	event_notes: string;
	event_type: SteamClanEventType;
	featured_app_tagid: number;
	follower_count: number;
	forum_topic_id: string;
	gid: string;
	gidfeature: string;
	gidfeature2: string;
	hidden: 0 | 1;
	ignore_count: number;
	jsondata: string;
	last_update_steamid: string;
	news_post_gid: string;
	published: 0 | 1;
	referenced_appids: number[];
	rtime32_end_time: number;
	rtime32_last_modified: number;
	rtime32_start_time: number;
	rtime32_visibility_end: number;
	rtime32_visibility_start: number;
	rtime_created: number;
	rtime_mod_reviewed: number;
	server_address: null | string;
	server_password: null | string;
	unlisted: 0 | 1;
	votes_down: number;
	votes_up: number;
};

/** Native `ajaxgetpartnerevent` body. Current SteamUI rejects responses without `success: 1`. */
export type SteamClanEventResponse = {
	event: null | SteamClanEvent;
	success: 1;
};

/** Native `ajaxgetadjacentpartnerevents` body. `success` must be `1`. */
export type SteamEventListResponse = {
	events: SteamClanEvent[];
	success: 1;
};

/** Clan info object `InternalSetupValue` copies from `ajaxgetvanityandclanid`. */
export type VanityClanIdResponse = {
	appid: number;
	avatar_full_url: string;
	avatar_medium_url: string;
	clanAccountID: number;
	clanSteamIDString: string;
	creator_page_bg_url?: string;
	curator_description: string;
	curator_title: string;
	group_name: string;
	has_rss_feed: boolean;
	has_visible_store_page: boolean;
	is_creator_home: boolean;
	is_curator: boolean;
	is_ogg: boolean;
	member_count: number;
	ogg_title?: string;
	partner_events_enabled: boolean;
	rss_language?: string;
	success: 1;
	vanity_url: string;
};

/** Native `ajaxgetpartnereventpermissions` body for a read-only shortcut clan. */
export type SteamPartnerEventPermissionsResponse = {
	can_edit: false;
	event_followed: [];
	event_followed_flags: [];
	event_ignored: [];
	follows_app: false;
	limited_user: false;
	owns_app: false;
	success: 1;
	support_user: false;
	valve_admin: false;
};
