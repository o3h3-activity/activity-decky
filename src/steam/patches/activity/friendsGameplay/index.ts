import { getFriendsGameplay } from "@api/activity";
import { callOriginal, replacePatch } from "@decky/ui";
import type { Games } from "@steam/games";
import { hasActivityIdentifiers } from "@steam/games/game";
import { LifetimeScope } from "@steam/lifetimeScope";
import { createSteamRpcResponse } from "@steam/patches/rpcResponse";
import { isSupportedShortcut } from "@steam/patches/shortcutEligibility";
import { AppStore } from "@steam/proxy/appStore";
import { PlayerService } from "@steam/proxy/playerService";
import { QueryClient } from "@steam/proxy/queryClient";
import {
	DEPENDENCY_POLL_INTERVAL_MS,
	DEPENDENCY_READY_TIMEOUT_MS,
	waitForDependency,
} from "@steam/waitForDependency";
import type { GetFriendsGameplayInfoResponse } from "@typings/friendsGameplay";
import type { SteamPlayerService } from "@typings/playerService";
import type { QueryCacheEntry, SteamQueryClient } from "@typings/queryClient";
import logger from "@utils/logger";
import { readRequestAppId } from "../protoRequest";
import type { VirtualFriendPatcher } from "../virtualFriends";
import { FriendsGameplayResponse } from "./friendsGameplayResponse";

const GAMEPLAY_INFO_QUERY_KEY_PATTERN = /^GameplayInfo_.+_(\d+)$/u;

const EMPTY_GAMEPLAY_INFO: GetFriendsGameplayInfoResponse = {
	in_game: [],
	in_wishlist: [],
	owns: [],
	played_ever: [],
	played_recently: [],
};

type SteamFriendsGameplayPatcherDependencies = Readonly<{
	games: Games;
	virtualFriendPatcher: VirtualFriendPatcher;
}>;

function invalidateShortcutGameplay(client: SteamQueryClient): void {
	client.invalidateQueries({
		predicate: (query: QueryCacheEntry) => {
			const key = query.queryKey?.[0];

			if (typeof key !== "string") {
				return false;
			}

			const match = GAMEPLAY_INFO_QUERY_KEY_PATTERN.exec(key);

			return (
				match !== null && AppStore.isAppShortcut(Number(match[1])) === true
			);
		},
	});
}

/**
 * Answers `Player.GetFriendsGameplayInfo` for supported shortcuts using
 * Activity playtime data.
 *
 * Steam reads the response through `Body().toObject()`, then looks up each
 * player's name and avatar. Friends must be registered with
 * `VirtualFriendPatcher` before the response is returned.
 *
 * Steam caches these reads under `GameplayInfo_<account>_<appid>`. Shortcut
 * entries are invalidated on installation and removal so an old result does
 * not hide the change. Other apps and malformed requests still go to Steam.
 * Once a shortcut request is accepted, an Activity fetch failure returns an
 * empty successful result; Steam has no playtime data for that local appid.
 */
export class SteamFriendsGameplayPatcher {
	private readonly scope = new LifetimeScope("FriendsGameplay");
	private readonly games: Games;
	private readonly virtualFriendPatcher: VirtualFriendPatcher;

	constructor({
		games,
		virtualFriendPatcher,
	}: SteamFriendsGameplayPatcherDependencies) {
		this.games = games;
		this.virtualFriendPatcher = virtualFriendPatcher;
		this.scope.installGuarded(
			() => this.installPatches(),
			"[FriendsGameplay] Failed to install patches",
		);
	}

	private async installPatches(): Promise<void> {
		const service = await waitForDependency(
			this.scope,
			() => PlayerService.getPlayerService(),
			DEPENDENCY_POLL_INTERVAL_MS,
			DEPENDENCY_READY_TIMEOUT_MS,
		);

		if (!service) {
			logger.error("[FriendsGameplay] Player service unavailable.");
			this.unMount();

			return;
		}

		const client = QueryClient.getQueryClient();

		if (client) {
			this.scope.addDisposer(() => invalidateShortcutGameplay(client));
		} else {
			logger.error(
				"[FriendsGameplay] QueryClient not found; cached gameplay info expires after one hour.",
			);
		}

		this.patchGetFriendsGameplayInfo(service);

		if (client) {
			invalidateShortcutGameplay(client);
		}
	}

	private patchGetFriendsGameplayInfo(service: SteamPlayerService): void {
		const patch = replacePatch(
			service,
			"GetFriendsGameplayInfo",
			(args: unknown[]) => {
				try {
					const appId = readRequestAppId(args, "appid");

					if (
						this.scope.signal.aborted ||
						!appId ||
						!isSupportedShortcut(this.games, appId)
					) {
						return callOriginal;
					}

					return this.createResponse(appId);
				} catch (error) {
					this.scope.signal.throwIfAborted();
					logger.error("[FriendsGameplay] Invalid gameplay request.", error);

					return callOriginal;
				}
			},
		);

		this.scope.add(patch);
	}

	/** Any failure answers with an empty gameplay body so Steam never asks its own servers for a shortcut. */
	private async createResponse(appId: number): Promise<object> {
		let info = EMPTY_GAMEPLAY_INFO;

		try {
			info = (await this.loadGameplay(appId)) ?? EMPTY_GAMEPLAY_INFO;
			this.scope.signal.throwIfAborted();
		} catch (error) {
			this.scope.signal.throwIfAborted();
			logger.error("[FriendsGameplay] Source request failed.", error);
		}

		return {
			BSuccess: () => true,
			...createSteamRpcResponse(() => ({ toObject: () => info })),
		};
	}

	/** `undefined` for an unrecognised shortcut, a failed request, or an invalid response. */
	private async loadGameplay(
		appId: number,
	): Promise<GetFriendsGameplayInfoResponse | undefined> {
		const release = await this.games.getRelease(appId);

		if (!hasActivityIdentifiers(release) || this.scope.signal.aborted) {
			return undefined;
		}

		const result = await getFriendsGameplay(
			release.gameId,
			release.releaseId,
			release.revisionId,
		);

		if (this.scope.signal.aborted) {
			return undefined;
		}

		if (!result.ok) {
			logger.error("[FriendsGameplay] Gameplay fetch failed.", {
				appId,
				error: result.error,
				status: result.status,
			});

			return undefined;
		}

		const gameplay = FriendsGameplayResponse.parse(result.data);

		if (!gameplay) {
			logger.error("[FriendsGameplay] Invalid gameplay response.", { appId });

			return undefined;
		}

		for (const friend of gameplay.friends) {
			this.virtualFriendPatcher.register(friend);
		}

		return gameplay.info;
	}

	public unMount(): void {
		this.scope.unMount();
	}
}
