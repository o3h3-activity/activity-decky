import { callOriginal, replacePatch } from "@decky/ui";
import type {
	AppAchievementResponse,
	AppAchievements,
} from "@decky/ui/dist/globals/steam-client/App";
import { EResult } from "@decky/ui/dist/globals/steam-client/shared";
import type { AchievementsProvider } from "@steam/achievements/achievementsProvider";
import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import { createSteamRpcResponse } from "@steam/patches/rpcResponse";
import { isSupportedShortcut } from "@steam/patches/shortcutEligibility";
import { AchievementService } from "@steam/proxy/achievementService";
import { App } from "@steam/proxy/app";
import { QueryClient } from "@steam/proxy/queryClient";
import {
	DEPENDENCY_POLL_INTERVAL_MS,
	DEPENDENCY_READY_TIMEOUT_MS,
	waitForDependency,
} from "@steam/waitForDependency";
import type { PlatformAchievement } from "@typings/achievements";
import type { QueryCacheEntry, SteamQueryClient } from "@typings/queryClient";
import { isObjectLike } from "@utils/isObjectLike";
import logger from "@utils/logger";
import { isPositiveSafeInteger } from "@utils/safeInteger";
import { isNil } from "es-toolkit";

const createEmptyAchievements = (): AppAchievements => ({
	nAchieved: 0,
	nTotal: 0,
	vecAchievedHidden: [],
	vecHighlight: [],
	vecUnachieved: [],
});

type AppDetailsStoreLike = {
	GetAchievements(appId: number): AppAchievements | undefined;
	GetAppData(appId: number): null | {
		details: Nullable<{ achievements?: AppAchievements; unAppID?: number }>;
	};
};

type NativeAchievementRequest = {
	appid?: unknown;
	steamid?: unknown;
};
type NativeSchemaAchievement = {
	api_name: string;
	archived: boolean;
	description: string;
	groupid: number;
	hidden: boolean;
	icon_achieved: string;
	icon_unachieved: string;
	internal_key: number;
	name: string;
};
type NativeAchievementSchema = {
	groups: { achievements: NativeSchemaAchievement[] }[];
};

const BASE_ACHIEVEMENT_GROUP_ID = 0;
const NATIVE_ACHIEVEMENTS_QUERY_KEY = "achievements";
const NATIVE_SCHEMA_QUERY_KEY_LENGTH = 3;

function isAlreadyInjected(
	current: AppAchievements | undefined,
	data: AppAchievements,
): boolean {
	return (
		current?.vecHighlight !== undefined &&
		current.nAchieved === data.nAchieved &&
		current.nTotal === data.nTotal &&
		current.vecHighlight[0]?.strID === data.vecHighlight[0]?.strID
	);
}

/**
 * Supplies provider achievements to each of Steam's achievement views.
 *
 * Patching one API is not enough; Steam reads achievements in three ways:
 * - `appDetailsStore.GetAchievements` returns a summary synchronously. A
 *   missing `vecHighlight` makes Steam load native cached data, so we return
 *   an empty summary while loading and later write the provider's summary.
 * - The SteamClient APIs return promises containing `result` and `data`.
 *   We supply the current user's list and an empty friend list.
 * - The newer UI calls `GetGameAchievements`,
 *   `GetGlobalAchievementPercentages`, and `GetUserAchievements`. It expects
 *   `GetEResult()` and `Body()` methods, not plain JSON.
 *
 * Schema, percentages, and unlocks must use the same `internal_key`: that is
 * how Steam joins the three responses. We use one-based provider-array
 * indexes and put every achievement in group 0. Steam creates this base group
 * even when the schema response has no groups.
 *
 * Only supported shortcuts are intercepted. The user-achievement RPC also
 * checks the requested SteamID, so it cannot return our user's unlocks for
 * someone else. Provider invalidation clears injected summaries and resets
 * the affected queries to avoid keeping unlocks from a previous account.
 */
export class SteamYourStuffAchievementsPatcher {
	private readonly scope = new LifetimeScope("Achievements");

	private readonly injectScheduled = new Map<number, number>();
	private readonly injectedAchievementsByAppId = new Map<
		number,
		AppAchievements
	>();

	private appDetailsStore: AppDetailsStoreLike | undefined;

	private readonly nativeQueryAppIds = new Set<number>();
	private nativeQueryClient: SteamQueryClient | undefined;

	constructor(
		private readonly provider: AchievementsProvider,
		private readonly games: Games,
	) {
		this.scope.addDisposer(
			this.provider.onInvalidated(() => {
				this.clearInjectedAchievements();
				this.resetNativeAchievementQueries();
			}),
		);

		this.scope.addDisposer(() => {
			this.clearInjectedAchievements();
			this.clearNativeAchievementQueries();
		});

		this.scope.installGuarded(
			() => this.installPatches(),
			"[Achievements] Failed to install patches",
		);
	}

	private async installPatches(): Promise<void> {
		const store = await waitForDependency(
			this.scope,
			() =>
				window.appDetailsStore as unknown as AppDetailsStoreLike | undefined,
			DEPENDENCY_POLL_INTERVAL_MS,
			DEPENDENCY_READY_TIMEOUT_MS,
		);

		if (!store) {
			logger.error(
				"[Achievements] `window.appDetailsStore` never appeared. Patch NOT installed.",
			);

			this.unMount();

			return;
		}

		this.appDetailsStore = store;

		logger.debug("[Achievements] `appDetailsStore` found. Installing patches.");
		this.patchGetAchievements(store);
		this.patchSteamClientAchievements(store);
		this.patchNativeAchievementQueries();

		const queryClient = this.getNativeQueryClient();

		if (queryClient) {
			queryClient.invalidateQueries({
				predicate: (query: QueryCacheEntry) => {
					const [area, appId] = query.queryKey ?? [];

					if (
						area !== NATIVE_ACHIEVEMENTS_QUERY_KEY ||
						typeof appId !== "number" ||
						!isSupportedShortcut(this.games, appId)
					) {
						return false;
					}

					this.nativeQueryAppIds.add(appId);

					return true;
				},
			});
		}
	}

	private patchGetAchievements(store: AppDetailsStoreLike): void {
		this.scope.add(
			replacePatch(store, "GetAchievements", (args) => {
				const appId = Number(args[0]);

				if (!isSupportedShortcut(this.games, appId)) {
					return callOriginal;
				}

				logger.once.debug(
					`[Achievements][GetAchievements] appId=${appId} is a shortcut -> ${this.provider.name}`,
				);

				const cached = this.provider.getCached(appId);
				const fromStore = store.GetAppData(appId)?.details?.achievements;

				if (!cached) {
					if (this.provider.shouldFetch(appId)) {
						void this.ensureAchievements(store, appId);
					}

					return fromStore &&
						this.injectedAchievementsByAppId.get(appId) === fromStore
						? fromStore
						: createEmptyAchievements();
				}

				if (fromStore && isAlreadyInjected(fromStore, cached.details)) {
					this.injectedAchievementsByAppId.set(appId, fromStore);

					return fromStore;
				}

				this.scheduleInject(store, appId, cached.details);

				return cached.details;
			}),
		);
	}

	private patchNativeAchievementQueries(): void {
		const service = AchievementService.getAchievementService();

		if (!service) {
			logger.error(
				"[Achievements] Native achievement service not found. Your Stuff achievements unpatched.",
			);

			return;
		}

		this.scope.add(
			replacePatch(service, "GetGameAchievements", (args) => {
				const request = this.readNativeAchievementRequest(args);

				if (!request || !isSupportedShortcut(this.games, request.appId)) {
					return callOriginal;
				}

				this.nativeQueryAppIds.add(request.appId);

				return this.respondNativeSchema(request.appId);
			}),
		);

		this.scope.add(
			replacePatch(service, "GetGlobalAchievementPercentages", (args) => {
				const request = this.readNativeAchievementRequest(args);

				if (!request || !isSupportedShortcut(this.games, request.appId)) {
					return callOriginal;
				}

				this.nativeQueryAppIds.add(request.appId);

				return this.respondNativeGlobalPercentages(request.appId);
			}),
		);

		this.scope.add(
			replacePatch(service, "GetUserAchievements", (args) => {
				const request = this.readNativeAchievementRequest(args);
				const currentSteamId = App.getCurrentUserIdAsU64();

				if (
					!request?.steamId ||
					currentSteamId !== request.steamId ||
					!isSupportedShortcut(this.games, request.appId)
				) {
					return callOriginal;
				}

				this.nativeQueryAppIds.add(request.appId);

				return this.respondNativeUserAchievements(request.appId);
			}),
		);
	}

	private readNativeAchievementRequest(
		args: unknown[],
	): undefined | { appId: number; steamId?: string } {
		const request = args[1];

		if (!isObjectLike(request)) {
			return undefined;
		}

		const candidate = request as NativeAchievementRequest;

		if (!isPositiveSafeInteger(candidate.appid)) {
			return undefined;
		}

		return {
			appId: candidate.appid,
			...(typeof candidate.steamid === "string" && candidate.steamid.length > 0
				? { steamId: candidate.steamid }
				: {}),
		};
	}

	private async respondNativeSchema(appId: number): Promise<object> {
		const achievements = await this.loadNativeAchievements(appId);
		const entries = this.createNativeSchemaAchievements(achievements);

		this.getNativeQueryClient();

		return this.createNativeResponse({
			groups: () => [],
			schema_hash: () => 0,
			schema_version: () => 0,
			toObject: () => ({
				achievements: entries.map((entry) => ({
					archived: entry.archived,
					groupid: entry.groupid,
					hidden: entry.hidden,
					icon: entry.icon_achieved,
					icon_gray: entry.icon_unachieved,
					internal_key: entry.internal_key,
					internal_name: entry.api_name,
					localized_desc: entry.description,
					localized_name: entry.name,
				})),
			}),
		});
	}

	private async respondNativeGlobalPercentages(appId: number): Promise<object> {
		const achievements = await this.loadNativeAchievements(appId);

		return this.createNativeResponse({
			achievements: () =>
				achievements.map((achievement, index) => ({
					internal_key: () => index + 1,
					player_percent_unlocked: () => achievement.global_percent,
				})),
		});
	}

	private async respondNativeUserAchievements(appId: number): Promise<object> {
		const achievements = await this.loadNativeAchievements(appId);
		let achievedCount = 0;
		let lastUnlockTime = 0;

		for (const achievement of achievements) {
			if (achievement.achieved) {
				achievedCount += 1;
				lastUnlockTime = Math.max(lastUnlockTime, achievement.unlock_time);
			}
		}

		return this.createNativeResponse({
			achievements: () =>
				achievements.map((achievement, index) => ({
					internal_key: () => index + 1,
					progress_float: () => undefined,
					progress_int: () => undefined,
					unlock_time: () => achievement.unlock_time,
					unlocked: () => achievement.achieved,
				})),
			groups: () =>
				achievements.length === 0
					? []
					: [
							{
								completed_achievements: () => achievedCount,
								groupid: () => BASE_ACHIEVEMENT_GROUP_ID,
								is_achievable: () => true,
								is_completed: () => achievedCount === achievements.length,
								time_completed: () =>
									achievedCount === achievements.length ? lastUnlockTime : 0,
							},
						],
			schema_hash: () => 0,
		});
	}

	private async loadNativeAchievements(
		appId: number,
	): Promise<PlatformAchievement[]> {
		const generation = this.provider.invalidationVersion;
		const mapped = await this.provider.getAchievements(appId);

		this.scope.signal.throwIfAborted();

		if (generation !== this.provider.invalidationVersion) {
			throw new DOMException("Activity account changed", "AbortError");
		}

		if (mapped === undefined) {
			throw new Error(
				`[Achievements] ${this.provider.name} metadata unavailable for appId=${appId}`,
			);
		}

		return mapped.platformAchievements;
	}

	private createNativeSchemaAchievements(
		achievements: PlatformAchievement[],
	): NativeSchemaAchievement[] {
		return achievements.map((achievement, index) => ({
			api_name: achievement.id,
			archived: false,
			description: achievement.description,
			groupid: BASE_ACHIEVEMENT_GROUP_ID,
			hidden: achievement.hidden,
			icon_achieved: achievement.unlocked_icon ?? achievement.icon,
			icon_unachieved: achievement.icon,
			internal_key: index + 1,
			name: achievement.name,
		}));
	}

	private createNativeResponse(body: object): object {
		return {
			...createSteamRpcResponse(() => body),
			Hdr: () => ({ transport_error: () => 0 }),
		};
	}

	/**
	 * Restores badge URLs after Steam converts the schema response.
	 *
	 * Steam prefixes `icon` and `icon_gray` with its app-image CDN path even
	 * when they already contain absolute URLs. Sending the right URLs in the
	 * RPC is not enough: we must fix `icon_achieved` and `icon_unachieved` in
	 * the cached schema, using `api_name` to find the provider achievement.
	 *
	 * Only `["achievements", appId, "schema"]` entries for intercepted apps are
	 * changed. Comparing URLs before `setQueryData` stops the resulting cache
	 * notification from triggering another write.
	 */
	private subscribeNativeSchemas(client: SteamQueryClient): void {
		this.scope.addDisposer(
			client.getQueryCache().subscribe((event) => {
				const key = event.query.queryKey;

				if (
					this.scope.signal.aborted ||
					event.type !== "updated" ||
					event.action?.type !== "success" ||
					key?.length !== NATIVE_SCHEMA_QUERY_KEY_LENGTH ||
					key[0] !== NATIVE_ACHIEVEMENTS_QUERY_KEY ||
					typeof key[1] !== "number" ||
					key[2] !== "schema" ||
					!isSupportedShortcut(this.games, key[1]) ||
					!this.nativeQueryAppIds.has(key[1])
				) {
					return;
				}

				const cached = this.provider.getCached(key[1]);
				const schema = client.getQueryData(key) as
					| NativeAchievementSchema
					| undefined;

				if (!cached || !Array.isArray(schema?.groups)) {
					return;
				}

				// Steam prefixes schema icons with its CDN, even for absolute badge URLs.
				let changed = false;
				const groups = schema.groups.map((group) => {
					let groupChanged = false;
					const achievements = group.achievements.map((achievement) => {
						const source = cached.platformAchievementsById.get(
							achievement.api_name,
						);
						const icon = source?.unlocked_icon ?? source?.icon;

						if (
							!source ||
							(achievement.icon_achieved === icon &&
								achievement.icon_unachieved === source.icon)
						) {
							return achievement;
						}

						groupChanged = true;

						return {
							...achievement,
							icon_achieved: icon,
							icon_unachieved: source.icon,
						};
					});

					if (!groupChanged) {
						return group;
					}

					changed = true;

					return { ...group, achievements };
				});

				if (changed) {
					client.setQueryData(key, { ...schema, groups });
				}
			}),
		);
	}

	private getNativeQueryClient(): SteamQueryClient | undefined {
		if (!this.nativeQueryClient) {
			const client = QueryClient.getQueryClient();

			if (client) {
				this.nativeQueryClient = client;
				this.subscribeNativeSchemas(client);
			}
		}

		return this.nativeQueryClient;
	}

	private resetNativeAchievementQueries(): void {
		const client = this.nativeQueryClient ?? QueryClient.getQueryClient();

		if (!client) {
			return;
		}

		void client.resetQueries({
			predicate: (query: QueryCacheEntry) => {
				const [area, appId] = query.queryKey ?? [];

				return (
					area === NATIVE_ACHIEVEMENTS_QUERY_KEY &&
					typeof appId === "number" &&
					this.nativeQueryAppIds.has(appId)
				);
			},
		});
	}

	private clearNativeAchievementQueries(): void {
		this.resetNativeAchievementQueries();
		this.nativeQueryAppIds.clear();
	}

	private patchSteamClientAchievements(store: AppDetailsStoreLike): void {
		const apps = SteamClient.Apps;

		this.scope.add(
			replacePatch(apps, "GetMyAchievementsForApp", (args) => {
				const appId = Number(args[0]);

				if (!isSupportedShortcut(this.games, appId)) {
					return callOriginal;
				}

				logger.once.debug(
					`[Achievements][GetMyAchievementsForApp] appId=${appId} is a shortcut -> ${this.provider.name}`,
				);

				return this.respondMyAchievements(store, appId);
			}),
		);

		this.scope.add(
			replacePatch(apps, "GetFriendAchievementsForApp", (args) => {
				const appId = Number(args[0]);

				if (!isSupportedShortcut(this.games, appId)) {
					return callOriginal;
				}

				logger.once.debug(
					`[Achievements][GetFriendAchievementsForApp] appId=${appId} -> empty (no friend ${this.provider.name} data)`,
				);

				return Promise.resolve({
					data: { rgAchievements: [] },
					result: EResult.OK,
				} satisfies AppAchievementResponse);
			}),
		);
	}

	private async respondMyAchievements(
		store: AppDetailsStoreLike,
		appId: number,
	): Promise<AppAchievementResponse> {
		await this.ensureAchievements(store, appId);

		const mapped = this.provider.getCached(appId);
		const rgAchievements = mapped?.rgAchievements ?? [];

		logger.debug(
			`[Achievements] GetMyAchievementsForApp(${appId}) -> ${String(rgAchievements.length)} item(s)`,
		);

		return {
			data: { rgAchievements },
			result: EResult.OK,
		};
	}

	private async ensureAchievements(
		store: AppDetailsStoreLike,
		appId: number,
	): Promise<void> {
		const generation = this.provider.invalidationVersion;
		const data = await this.provider.getAchievements(appId);

		if (!data || generation !== this.provider.invalidationVersion) {
			return;
		}

		this.scheduleInject(store, appId, data.details);
	}

	/**
	 * Writes the summary on the next tick, outside `GetAchievements`.
	 *
	 * Reads for the same app share one pending timer. The callback looks up
	 * the current app data again because Steam may have replaced `details`
	 * while it waited. Logout or a provider account change cancels the write.
	 */
	private scheduleInject(
		store: AppDetailsStoreLike,
		appId: number,
		data: AppAchievements,
	): void {
		if (this.scope.signal.aborted || this.injectScheduled.has(appId)) {
			return;
		}

		const generation = this.provider.invalidationVersion;

		this.injectScheduled.set(appId, generation);

		setTimeout(() => {
			if (this.injectScheduled.get(appId) === generation) {
				this.injectScheduled.delete(appId);
			}

			if (
				this.scope.signal.aborted ||
				generation !== this.provider.invalidationVersion
			) {
				return;
			}

			this.inject(store, appId, data);
		}, 0);
	}

	/**
	 * Removes a summary only if it is still the object we injected.
	 * Steam can replace `details` through `AppDetailsChanged`; cleanup must
	 * not delete achievement data written since then.
	 */
	private clearInjectedAchievements(): void {
		this.injectScheduled.clear();
		const store = this.appDetailsStore;

		if (store) {
			for (const [appId, achievements] of this.injectedAchievementsByAppId) {
				const details = store.GetAppData(appId)?.details;

				if (details?.achievements === achievements) {
					delete details.achievements;
				}
			}
		}

		this.injectedAchievementsByAppId.clear();
	}

	private inject(
		store: AppDetailsStoreLike,
		appId: number,
		data: AppAchievements,
	): void {
		const appData = store.GetAppData(appId);

		if (isNil(appData)) {
			logger.error(
				`[Achievements] GetAppData(${appId}) returned nothing. Cannot inject.`,
			);

			return;
		}

		const current = appData.details?.achievements;

		if (isAlreadyInjected(current, data)) {
			if (current) {
				this.injectedAchievementsByAppId.set(appId, current);
			}

			return;
		}

		if (isNil(appData.details)) {
			appData.details = { achievements: data, unAppID: appId };
		} else {
			appData.details.achievements = data;
		}

		this.injectedAchievementsByAppId.set(appId, data);

		logger.debug(
			`[Achievements] Injected into appDetailsStore: appId=${appId}`,
		);
	}

	unMount(): void {
		this.scope.unMount();
	}
}
