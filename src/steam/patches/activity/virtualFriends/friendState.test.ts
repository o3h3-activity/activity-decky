import { describe, expect, it } from "vitest";
import { createActivityFriendState } from "./friendState";

const friend = {
	avatarUrl: "https://example.com/ada.png",
	nickname: "Ada",
	steamId: "76561197960287930",
};

const steamId = { ConvertTo64BitString: () => friend.steamId };

describe("createActivityFriendState", () => {
	it("returns an existing friend state unchanged", () => {
		const state = { is_friend: true, persona: { m_bInitialized: true } };

		expect(createActivityFriendState(state, friend, steamId)).toBe(state);
	});

	it("marks a registered non-friend as a friend", () => {
		const state = { is_friend: false, persona: { m_bInitialized: true } };

		expect(createActivityFriendState(state, friend, steamId)).toMatchObject({
			is_friend: true,
			persona: state.persona,
		});
	});

	it("overlays API persona details only when Steam persona is uninitialized", () => {
		const initializedState = {
			is_friend: false,
			persona: { m_bInitialized: true, m_strPlayerName: "Steam Ada" },
		};
		const initialized = createActivityFriendState(
			initializedState,
			friend,
			steamId,
		);
		const uninitialized = createActivityFriendState(
			{ is_friend: false, persona: { m_bInitialized: false } },
			friend,
			steamId,
		);

		expect(initialized).toMatchObject({ is_friend: true });
		expect(initialized.persona).toBe(initializedState.persona);
		expect(uninitialized).toMatchObject({
			display_name: "Ada",
			nickname: "Ada",
			persona: {
				avatar_url: "https://example.com/ada.png",
				m_strPlayerName: "Ada",
			},
		});
	});
});
