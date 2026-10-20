import { callOriginal, replacePatch } from "@decky/ui";
import { LifetimeScope } from "@steam/lifetimeScope";
import { FriendStore } from "@steam/proxy/friendStore";
import {
	DEPENDENCY_POLL_INTERVAL_MS,
	DEPENDENCY_READY_TIMEOUT_MS,
	waitForDependency,
} from "@steam/waitForDependency";
import type { FriendState, SteamFriendStore } from "@typings/friendStore";
import type { ActivityFriend } from "@typings/virtualFriend";
import { isObjectLike } from "@utils/isObjectLike";
import logger from "@utils/logger";
import { getAccountId, isSteamId, parseSteamId } from "../steamId";
import { createActivityFriendState } from "./friendState";

function isFriendState(value: unknown): value is FriendState {
	return isObjectLike(value);
}

export class VirtualFriendPatcher {
	private readonly scope = new LifetimeScope("ActivityFriends");
	private readonly friendsByAccountId = new Map<number, ActivityFriend>();
	private readonly friendsBySteamId = new Map<string, ActivityFriend>();
	private installed = false;

	constructor() {
		this.scope.addDisposer(() => {
			this.friendsByAccountId.clear();
			this.friendsBySteamId.clear();
		});

		this.scope.installGuarded(
			() => this.installPatches(),
			"[ActivityFriends] Failed to install patches",
		);
	}

	public get isInstalled(): boolean {
		return this.installed && !this.scope.signal.aborted;
	}

	public register(friend: ActivityFriend): boolean {
		if (this.scope.signal.aborted) {
			return false;
		}

		const previous = this.friendsBySteamId.get(friend.steamId);

		if (
			previous &&
			previous.nickname === friend.nickname &&
			previous.avatarUrl === friend.avatarUrl
		) {
			return false;
		}

		this.friendsBySteamId.set(friend.steamId, friend);
		this.friendsByAccountId.set(getAccountId(BigInt(friend.steamId)), friend);

		return true;
	}

	private async installPatches(): Promise<void> {
		const friendStore = await waitForDependency(
			this.scope,
			() => FriendStore.getFriendStore(),
			DEPENDENCY_POLL_INTERVAL_MS,
			DEPENDENCY_READY_TIMEOUT_MS,
		);

		if (!friendStore) {
			logger.error("[ActivityFriends] Friend store not found.");
			this.unMount();

			return;
		}

		this.patchFriendState(friendStore);
		this.installed = true;
	}

	private patchFriendState(friendStore: SteamFriendStore): void {
		const patch = replacePatch(
			friendStore,
			"GetFriendState",
			(args: unknown[]) => {
				const friend = this.getFriend(args[0]);

				if (!friend) {
					return callOriginal;
				}

				const state: unknown = Reflect.apply(patch.original, friendStore, args);

				if (!isFriendState(state) || state.is_friend) {
					return state;
				}

				return createActivityFriendState(
					state,
					friend,
					isSteamId(args[0]) ? args[0] : undefined,
				);
			},
		);

		this.scope.add(patch);
	}

	private getFriend(value: unknown): ActivityFriend | undefined {
		if (typeof value === "number") {
			return this.friendsByAccountId.get(value);
		}

		let steamId: bigint | undefined;

		if (typeof value === "string") {
			steamId = parseSteamId(value);
		} else if (isSteamId(value)) {
			steamId = parseSteamId(value.ConvertTo64BitString());
		}

		return steamId ? this.friendsBySteamId.get(steamId.toString()) : undefined;
	}

	public unMount(): void {
		this.scope.unMount();
	}
}
