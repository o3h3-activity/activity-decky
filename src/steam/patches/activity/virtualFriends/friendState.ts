import type { FriendPersona, FriendState, SteamId } from "@typings/friendStore";
import type { ActivityFriend } from "@typings/virtualFriend";
import { isObjectLike } from "@utils/isObjectLike";

const DEFAULT_AVATAR_HASH = "0000000000000000000000000000000000000000";

function writableValue(value: unknown): PropertyDescriptor {
	return { configurable: true, enumerable: true, value, writable: true };
}

function createPersona(
	source: FriendPersona,
	friend: ActivityFriend,
	steamId: SteamId | undefined,
): FriendPersona {
	const persona = Object.create(source) as FriendPersona;
	const properties: PropertyDescriptorMap = {
		m_gameid: writableValue("0"),
		m_mapRichPresence: writableValue(new Map<string, string>()),
		m_strGameExtraInfo: writableValue(""),
		m_strPlayerName: writableValue(friend.nickname ?? ""),
		m_unGamePlayedAppID: writableValue(0),
	};

	if (friend.avatarUrl) {
		properties.avatar_url = writableValue(friend.avatarUrl);
		properties.avatar_url_full = writableValue(friend.avatarUrl);
		properties.avatar_url_medium = writableValue(friend.avatarUrl);
	} else {
		properties.m_strAvatarHash = writableValue(DEFAULT_AVATAR_HASH);
	}

	if (steamId) {
		properties.m_steamid = writableValue(steamId);
	}

	Object.defineProperties(persona, properties);

	return persona;
}

/** Marks an Activity actor as a Steam friend without overwriting initialized Steam persona data. */
export function createActivityFriendState(
	state: FriendState,
	friend: ActivityFriend,
	steamId: SteamId | undefined,
): FriendState {
	if (state.is_friend) {
		return state;
	}

	const properties: PropertyDescriptorMap = { is_friend: writableValue(true) };
	const persona = state.persona;

	if (isObjectLike(persona) && !persona.m_bInitialized) {
		properties.display_name = writableValue(friend.nickname ?? "");
		properties.nickname = writableValue(friend.nickname ?? "");
		properties.persona = writableValue(createPersona(persona, friend, steamId));
	}

	return Object.defineProperties(
		Object.create(state) as FriendState,
		properties,
	);
}
