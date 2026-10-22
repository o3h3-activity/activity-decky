import { callOriginal, replacePatch } from "@decky/ui";
import type { AchievementsProvider } from "@steam/achievements/achievementsProvider";
import type { Games } from "@steam/games";
import { type GameRelease, hasActivityIdentifiers } from "@steam/games/game";
import { LifetimeScope } from "@steam/lifetimeScope";
import { parseSteamId } from "@steam/patches/activity/steamId";
import { createSteamRpcResponse } from "@steam/patches/rpcResponse";
import { isSupportedShortcut } from "@steam/patches/shortcutEligibility";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import { AppActivityStore } from "@steam/proxy/appActivityStore";
import { QueryClient } from "@steam/proxy/queryClient";
import { StoreItemCache } from "@steam/proxy/storeItemCache";
import { UserNewsService } from "@steam/proxy/userNewsService";
import {
	DEPENDENCY_POLL_INTERVAL_MS,
	DEPENDENCY_READY_TIMEOUT_MS,
	waitForDependency,
} from "@steam/waitForDependency";
import type { SteamAppActivity } from "@typings/appActivityStore";
import type { ParsedUserNewsFeed } from "@typings/userNews";
import type {
	SteamUserGameActivityService,
	SteamUserNewsProtoEventConstructor,
	SteamUserNewsService,
} from "@typings/userNewsService";
import logger from "@utils/logger";
import { waitFor } from "@utils/waitFor";
import { isNil } from "es-toolkit";
import { readRequestAppId } from "../protoRequest";
import type { UserStatusPatcher } from "../userStatus";
import type { VirtualFriendPatcher } from "../virtualFriends";
import { AchievementUnlockedUserNewsEventHandler } from "./events/achievementUnlocked";
import { AnnouncementUserNewsEventHandler } from "./events/announcement";
import { PlayedFirstTimeUserNewsEventHandler } from "./events/playedFirstTime";
import { ReceivedNewGameUserNewsEventHandler } from "./events/receivedNewGame";
import type {
	UserNewsEventContext,
	UserNewsEventResult,
	UserNewsRequest,
} from "./events/types";
import type { UserNewsFeedEventHandler } from "./events/userNewsFeedEventHandler";
import { UserStatusUserNewsEventHandler } from "./events/userStatus";
import { UserNewsFeed } from "./feed/userNewsFeed";
import { UserNewsRequests } from "./rpc/userNewsRequests";
import {
	type GetUserNewsRpcResponse,
	UserNewsRpcResponse,
} from "./rpc/userNewsRpcResponse";
import { ShortcutActivityCommentsPatcher } from "./shortcuts/shortcutActivityCommentsPatcher";
import { ShortcutStoreItemPatcher } from "./shortcuts/shortcutStoreItemPatcher";

const PATCH_POLL_INTERVAL_MS = 500;
const PATCH_READY_TIMEOUT_MS = 5000;
const INITIAL_OLDEST_ACTIVITY_TIME = 4_294_967_295;

type SteamUserNewsPatcherDependencies = Readonly<{
	games: Games;
	userStatus: UserStatusPatcher;
	virtualFriendPatcher: VirtualFriendPatcher;
}>;

/**
 * Fills a supported shortcut's Activity feed with Activity API events.
 *
 * Steam fetches `GetUserNews` and `UserGameActivity.GetActivity` together
 * and refuses to merge either result if one fails. We convert the feed to
 * `CUserNews_Event` objects and return an empty successful game-activity
 * response. Replacing only `GetUserNews` would leave the feed empty when
 * the companion request failed.
 *
 * Before Steam merges the events, we prepare the shortcut's StoreItem,
 * register its authors, and set up status-text lookups. Missing dependencies
 * or conversion data leave the UserNews request to Steam. Global feeds and
 * unsupported apps are not intercepted.
 *
 * The spotlight hook returns no featured events for shortcuts and registers
 * their synthetic clan IDs for later event and image requests.
 */
export class SteamUserNewsPatcher {
	private readonly scope = new LifetimeScope("UserNews");
	private readonly storeItems: ShortcutStoreItemPatcher;
	private readonly initializedFeeds = new Set<number>();

	private readonly activityComments = this.scope.track(
		new ShortcutActivityCommentsPatcher(),
	);

	private readonly announcementHandler: AnnouncementUserNewsEventHandler;
	private readonly feedHandlers: readonly UserNewsFeedEventHandler[];
	private readonly games: Games;
	private readonly userStatus: UserStatusPatcher;
	private readonly virtualFriendPatcher: VirtualFriendPatcher;

	constructor(
		provider: AchievementsProvider,
		shortcutClans: ShortcutClanRegistry,
		{
			games,
			userStatus,
			virtualFriendPatcher,
		}: SteamUserNewsPatcherDependencies,
	) {
		this.games = games;
		this.userStatus = userStatus;
		this.virtualFriendPatcher = virtualFriendPatcher;
		this.storeItems = this.scope.track(new ShortcutStoreItemPatcher(games));
		this.announcementHandler = new AnnouncementUserNewsEventHandler(
			shortcutClans,
		);

		this.feedHandlers = [
			new AchievementUnlockedUserNewsEventHandler(provider),
			new ReceivedNewGameUserNewsEventHandler(),
			new PlayedFirstTimeUserNewsEventHandler(),
			new UserStatusUserNewsEventHandler(userStatus),
		];

		this.scope.installGuarded(
			() => this.installPatches(),
			"[UserNews] Failed to install patches",
		);
	}

	private async installPatches(): Promise<void> {
		if (this.scope.signal.aborted) {
			return;
		}

		const dependencies = await waitForDependency(
			this.scope,
			() => {
				const service = UserNewsService.getUserNewsService();
				const gameActivityService =
					UserNewsService.getUserGameActivityService();
				const proto = UserNewsService.getProtoEventConstructor();
				const storeItemCache = StoreItemCache.getStoreItemCache();
				const queryClient = QueryClient.getQueryClient();

				return !isNil(service) &&
					!isNil(gameActivityService) &&
					!isNil(proto) &&
					!isNil(storeItemCache) &&
					!isNil(queryClient)
					? { service, gameActivityService, proto, storeItemCache, queryClient }
					: undefined;
			},
			DEPENDENCY_POLL_INTERVAL_MS,
			DEPENDENCY_READY_TIMEOUT_MS,
		);

		if (!dependencies) {
			logger.error(
				"[UserNews] News/game activity services, event protocol, StoreItem cache, or query client not found.",
			);

			this.unMount();

			return;
		}

		const { service, gameActivityService, proto, storeItemCache, queryClient } =
			dependencies;

		this.storeItems.install(storeItemCache, queryClient);
		this.patchGetUserNews(service, proto);
		this.patchGetGameActivity(gameActivityService);
		this.patchGetAppDetailsSpotlight(service);
	}

	private patchGetUserNews(
		service: SteamUserNewsService,
		proto: SteamUserNewsProtoEventConstructor,
	): void {
		const patch = replacePatch(service, "GetUserNews", (args: unknown[]) => {
			const callSteam = (): unknown => {
				this.scope.signal.throwIfAborted();

				return Reflect.apply(patch.original, service, args) as unknown;
			};

			const invokeOriginal = (appId?: number, error?: unknown): unknown => {
				this.scope.signal.throwIfAborted();
				logger.error(
					"[UserNews] Custom response unavailable; falling back to Steam.",
					{ appId, error },
				);

				return callSteam();
			};

			try {
				const request = UserNewsRequests.read(args);

				if (
					this.scope.signal.aborted ||
					!request ||
					!isSupportedShortcut(this.games, request.appId)
				) {
					return callOriginal;
				}

				return this.respondToShortcut(request, proto, callSteam, (error) =>
					invokeOriginal(request.appId, error),
				);
			} catch (error) {
				return invokeOriginal(undefined, error);
			}
		});

		this.scope.add(patch);
	}

	/**
	 * Returns no trading-card activity for shortcuts. The response still
	 * needs to succeed or Steam will discard the UserNews result too.
	 */
	private patchGetGameActivity(service: SteamUserGameActivityService): void {
		this.scope.add(
			replacePatch(service, "GetActivity", (args: unknown[]) => {
				const appId = readRequestAppId(args, "appid");

				if (!appId || !isSupportedShortcut(this.games, appId)) {
					return callOriginal;
				}

				return createSteamRpcResponse(() => ({ events: () => [] }));
			}),
		);
	}

	private async respondToShortcut(
		request: UserNewsRequest,
		proto: SteamUserNewsProtoEventConstructor,
		callSteam: () => unknown,
		fallBackToSteam: (error?: unknown) => unknown,
	): Promise<unknown> {
		const release = await this.games.getRelease(request.appId);

		if (!hasActivityIdentifiers(release)) {
			return callSteam();
		}

		let response: GetUserNewsRpcResponse | undefined;

		try {
			response = await this.createResponse(request, release, proto);
		} catch (error: unknown) {
			return fallBackToSteam(error);
		}

		return response ?? fallBackToSteam();
	}

	private patchGetAppDetailsSpotlight(service: SteamUserNewsService): void {
		this.scope.add(
			replacePatch(service, "GetAppDetailsSpotlight", (args: unknown[]) => {
				const appId = readRequestAppId(args, "appid");

				if (
					!appId ||
					!isSupportedShortcut(this.games, appId) ||
					!this.storeItems.ensure(appId)
				) {
					return callOriginal;
				}

				this.announcementHandler.registerShortcutApp(appId);

				return UserNewsRpcResponse.emptySpotlight();
			}),
		);
	}

	/**
	 * Rebuilds the feed once per app before resuming incremental reads.
	 *
	 * Steam asks for new events after `GetNewestActivityTime() + 1` and older
	 * events before `GetOldestActivityTime() - 1`. Its cache can survive a
	 * plugin reload while our status registry does not. Reusing those cursors
	 * would skip the events needed to restore status-text lookups.
	 *
	 * The first forward request (`endTime === 0`) therefore starts at zero.
	 * Once conversion succeeds, we clear the cached days and reset Steam's
	 * cursors: oldest to `4294967295`, newest to `0`, and "no more history"
	 * to false. Steam's merge then fills them from the new events. A failed
	 * conversion leaves the days, cursors, and initialization flag alone.
	 */
	private async createResponse(
		request: UserNewsRequest,
		release: GameRelease,
		proto: SteamUserNewsProtoEventConstructor,
	): Promise<GetUserNewsRpcResponse | undefined> {
		const ready = await waitFor(
			() =>
				this.virtualFriendPatcher.isInstalled && this.userStatus.isInstalled,
			PATCH_POLL_INTERVAL_MS,
			PATCH_READY_TIMEOUT_MS,
			this.scope.signal,
		);

		if (!ready || this.scope.signal.aborted) {
			return undefined;
		}

		const context = this.createEventContext(request.appId, proto);

		if (!context) {
			return undefined;
		}

		// Steam's cached watermark can belong to statuses whose secondary lookup
		// data was lost on reload. Rebuild once before resuming incremental reads.
		const initializeFeed =
			request.endTime === 0 && !this.initializedFeeds.has(request.appId);
		const feedRequest = initializeFeed ? { ...request, startTime: 0 } : request;

		const feed = await UserNewsFeed.load(
			release,
			feedRequest,
			this.scope.signal,
		);

		if (!feed || this.scope.signal.aborted) {
			return undefined;
		}

		const results = await this.createEventResults(feed, feedRequest, context);

		if (results === undefined || this.scope.signal.aborted) {
			return undefined;
		}

		this.registerActivityFriends(feed, context.activity);
		const response = UserNewsRpcResponse.fromEventResults(results, feedRequest);

		if (initializeFeed) {
			context.activity.m_mapActivityByDay.clear();
			context.activity.m_rtOldestActivityTime = INITIAL_OLDEST_ACTIVITY_TIME;
			context.activity.m_rtNewestActivityTime = 0;
			context.activity.m_bNoMoreHistoryAvailable = false;
			this.initializedFeeds.add(request.appId);
		}

		return response;
	}

	private async createEventResults(
		feed: ParsedUserNewsFeed,
		request: UserNewsRequest,
		context: UserNewsEventContext,
	): Promise<undefined | UserNewsEventResult[]> {
		const feedResults: UserNewsEventResult[] = [];

		for (const handler of this.feedHandlers) {
			const results = await handler.createFromFeed(feed.events, context);

			if (results === undefined || this.scope.signal.aborted) {
				return undefined;
			}

			feedResults.push(...results);
		}

		const announcements = await this.announcementHandler.create(
			request,
			context,
		);

		return [...announcements, ...feedResults];
	}

	private registerActivityFriends(
		feed: ParsedUserNewsFeed,
		activity: SteamAppActivity,
	): void {
		const currentSteamId = parseSteamId(
			AppActivityStore.getCurrentUserSteamId(),
		)?.toString();
		let friendsChanged = false;

		for (const { actor } of feed.events) {
			if (actor.steamId !== currentSteamId) {
				friendsChanged =
					this.virtualFriendPatcher.register(actor) || friendsChanged;
			}
		}

		if (friendsChanged) {
			activity.SortEvents();
		}
	}

	private createEventContext(
		appId: number,
		proto: SteamUserNewsProtoEventConstructor,
	): undefined | UserNewsEventContext {
		const activity = AppActivityStore.getAppActivity(appId);

		if (
			!activity ||
			!AppActivityStore.getCurrentUserSteamId() ||
			!this.storeItems.ensure(appId)
		) {
			logger.error("[UserNews] Activity store or shortcut item unavailable.", {
				appId,
			});

			return undefined;
		}

		this.activityComments.patch(activity);

		return { activity, appId, gameId: String(appId), proto };
	}

	public unMount(): void {
		this.scope.unMount();
	}
}
