import type { RedirectMatch } from "@steam/patches/requests/requestPatcher";
import {
	clanAccountIdFromAppId,
	clanAccountIdFromSteamId64,
	clanSteamId64,
} from "@steam/patches/shortcuts/clanIdentity";
import type {
	SteamClanEventResponse,
	SteamEventListResponse,
	SteamPartnerEventPermissionsResponse,
	VanityClanIdResponse,
} from "@typings/activity";
import type { SteamAjaxRequestConfig } from "@typings/steamAjaxRequest";
import { getAnnouncement, getAnnouncements } from "./announcementSource";
import { SAMPLE_EVENT_CAPSULE } from "./eventImages";

/** `/gid/<clanSteamId64>/ajaxgetvanityandclanid/` — clan SteamID64 in the path. */
const VANITY_GID = /\/gid\/(\d+)\/ajaxgetvanityandclanid\//u;
/** `/ogg/<appId>/ajaxgetvanityandclanid/` — official game group; app id in the path. */
const VANITY_OGG = /\/ogg\/(\d+)\/ajaxgetvanityandclanid\//u;
/** `/games/<vanity>/ajaxgetvanityandclanid/` — store vanity slug; no numeric id. */
const VANITY_GAMES = /\/games\/[^/]+\/ajaxgetvanityandclanid\//u;
/** `/groups/<vanity>/ajaxgetvanityandclanid/` — community group vanity slug; no numeric id. */
const VANITY_GROUPS = /\/groups\/[^/]+\/ajaxgetvanityandclanid\//u;
/** `/gid/<clanSteamId64>/ajaxgetpartnereventpermissions` — clan SteamID64; follow/edit rights. */
const PERMISSIONS_GID = /\/gid\/(\d+)\/ajaxgetpartnereventpermissions/u;

const PARTNER_EVENT_EXCLUDES = [
	"ajaxgetpartnereventspageable",
	"ajaxgetpartnereventpermissions",
	"ajaxgetpartnereventforedit",
];

function parseNumeric(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === "string" && /^\d+$/u.test(value)) {
		return Number(value);
	}

	return undefined;
}

function readParam(
	url: URL,
	config: SteamAjaxRequestConfig | undefined,
	key: string,
): unknown {
	if (url.searchParams.has(key)) {
		return url.searchParams.get(key);
	}

	return config?.params?.[key];
}

function matchAppOrClan(
	url: string,
	config?: SteamAjaxRequestConfig,
): RedirectMatch {
	let parsed: URL;

	try {
		parsed = new URL(url, "https://store.steampowered.com");
	} catch {
		return { shouldBeRedirected: false };
	}

	const appId = parseNumeric(readParam(parsed, config, "appid"));

	if (appId !== undefined && appId > 0) {
		return { appId, shouldBeRedirected: true };
	}

	const clanAccountId = parseNumeric(
		readParam(parsed, config, "clan_accountid"),
	);

	if (clanAccountId === undefined) {
		return { shouldBeRedirected: false };
	}

	return { clanAccountId, shouldBeRedirected: true };
}

function vanityResponse(match: RedirectMatch): VanityClanIdResponse {
	const clanAccountId =
		match.clanAccountId ?? clanAccountIdFromAppId(match.appId ?? 0);
	const appId = match.appId ?? 0;

	return {
		appid: appId,
		avatar_full_url: SAMPLE_EVENT_CAPSULE,
		avatar_medium_url: SAMPLE_EVENT_CAPSULE,
		clanAccountID: clanAccountId,
		clanSteamIDString: clanSteamId64(clanAccountId),
		curator_description: "",
		curator_title: "",
		group_name: "Non-Steam",
		has_rss_feed: false,
		has_visible_store_page: false,
		is_creator_home: false,
		is_curator: false,
		is_ogg: true,
		member_count: 0,
		partner_events_enabled: true,
		success: 1,
		vanity_url: "",
	};
}

function partnerEventPermissionsResponse(): SteamPartnerEventPermissionsResponse {
	return {
		can_edit: false,
		event_followed: [],
		event_followed_flags: [],
		event_ignored: [],
		follows_app: false,
		limited_user: false,
		owns_app: false,
		success: 1,
		support_user: false,
		valve_admin: false,
	};
}

/**
 * Answers Steam's game-group lookup for a supported shortcut or registered clan.
 *
 * `ogg/{appid}` contains an appid, while `gid/{steamid}` contains a clan
 * SteamID64. We keep that distinction so the request patcher can check app
 * support or clan registration before returning the synthetic group details.
 * The `games/{vanity}` and `groups/{vanity}` forms contain neither ID, so
 * they are left to Steam.
 */
export class SteamVanityClanIdRoute {
	static matchUrl(url: string): RedirectMatch {
		const ogg = VANITY_OGG.exec(url);

		if (ogg) {
			return { appId: Number(ogg[1]), shouldBeRedirected: true };
		}

		const gid = VANITY_GID.exec(url);

		if (gid) {
			const clanAccountId = clanAccountIdFromSteamId64(gid[1]);

			return clanAccountId === undefined
				? { shouldBeRedirected: false }
				: { clanAccountId, shouldBeRedirected: true };
		}

		if (VANITY_GAMES.test(url) || VANITY_GROUPS.test(url)) {
			return { shouldBeRedirected: true };
		}

		return { shouldBeRedirected: false };
	}

	static async resolve(match: RedirectMatch): Promise<VanityClanIdResponse> {
		return vanityResponse(match);
	}
}

/**
 * Loads a single announcement for a shortcut app or its registered clan.
 *
 * Steam sends `appid` or `clan_accountid` in either the URL or Axios params
 * and expects `{ success, event }` back. Several other endpoints start with
 * `ajaxgetpartnerevent`, so the matcher excludes paging, permissions, and
 * editing requests.
 *
 * A missing announcement returns `{ success: 1, event: null }`. Returning
 * `undefined` would make the request patcher retry against Steam instead.
 * Steam has no explicit null-event case: its loader catches the failure to
 * process the event and returns no model.
 */
export class SteamPartnerEventRoute {
	static matchUrl(url: string, config?: SteamAjaxRequestConfig): RedirectMatch {
		if (!url.includes("events/ajaxgetpartnerevent")) {
			return { shouldBeRedirected: false };
		}

		for (const excluded of PARTNER_EVENT_EXCLUDES) {
			if (url.includes(excluded)) {
				return { shouldBeRedirected: false };
			}
		}

		return matchAppOrClan(url, config);
	}

	static async resolve(match: RedirectMatch): Promise<SteamClanEventResponse> {
		const event = await getAnnouncement({
			appId: match.appId,
			clanAccountId: match.clanAccountId,
		});

		// Complete interception rather than asking the request patcher to retry
		// natively; Steam's event-loader catch handles the missing event.
		// oxlint-disable-next-line unicorn/no-null
		return { event: event ?? null, success: 1 };
	}
}

/**
 * Answers Steam's request for announcements around a given event.
 *
 * The caller checks `data.success` and reads `data.events`, so this route
 * returns a successful list response even when the source has no events.
 * An unavailable source becomes an empty array rather than a fallback
 * request for a synthetic clan. App support and clan registration are
 * checked by the shared request patcher.
 */
export class SteamAdjacentPartnerEventsRoute {
	static matchUrl(url: string, config?: SteamAjaxRequestConfig): RedirectMatch {
		if (!url.includes("events/ajaxgetadjacentpartnerevents")) {
			return { shouldBeRedirected: false };
		}

		return matchAppOrClan(url, config);
	}

	static async resolve(match: RedirectMatch): Promise<SteamEventListResponse> {
		const events = await getAnnouncements({
			appId: match.appId,
			clanAccountId: match.clanAccountId,
		});

		return { events: events === undefined ? [] : [...events], success: 1 };
	}
}

/**
 * Supplies empty permissions for a shortcut's synthetic clan.
 *
 * Steam uses a `/gid/{steamid}/` URL in community pages and a clan-account
 * query parameter in store/partner pages. Both forms must reach the same
 * registration check. A matching request succeeds, but edit, follow,
 * ownership, support, and admin fields stay false or empty.
 */
export class SteamPartnerEventPermissionsRoute {
	static matchUrl(url: string): RedirectMatch {
		if (!url.includes("ajaxgetpartnereventpermissions")) {
			return { shouldBeRedirected: false };
		}

		const gid = PERMISSIONS_GID.exec(url);

		if (gid) {
			const clanAccountId = clanAccountIdFromSteamId64(gid[1]);

			return clanAccountId === undefined
				? { shouldBeRedirected: false }
				: { clanAccountId, shouldBeRedirected: true };
		}

		return matchAppOrClan(url);
	}

	static async resolve(): Promise<SteamPartnerEventPermissionsResponse> {
		return partnerEventPermissionsResponse();
	}
}
