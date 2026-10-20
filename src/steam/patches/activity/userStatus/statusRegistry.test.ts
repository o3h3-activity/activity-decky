import { describe, expect, it } from "vitest";
import { UserStatusRegistry } from "./statusRegistry";

const owned = {
	accountId: 1,
	appId: 42,
	commentId: "owned-comment",
	ownedByCurrentUser: true,
	postId: "100",
	statusText: "Mine",
	steamId: "76561197960265729",
};

const other = {
	accountId: 2,
	appId: 42,
	commentId: "other-comment",
	ownedByCurrentUser: false,
	postId: "100",
	statusText: "Theirs",
	steamId: "76561197960265730",
};

describe("UserStatusRegistry", () => {
	it("makes every comment available to Steam's actor and post lookup", () => {
		const registry = new UserStatusRegistry();

		registry.register(other);

		expect(registry.get(other.steamId, other.postId)).toEqual(other);
	});

	it("only makes owned comments available to deletion by post id", () => {
		const registry = new UserStatusRegistry();

		registry.register(other);
		registry.register(owned);

		expect(registry.getOwnedByPostId(other.postId)).toEqual(owned);
		registry.deleteOwnedByPostId(other.postId);
		expect(registry.get(other.steamId, other.postId)).toEqual(other);
		expect(registry.getOwnedByPostId(other.postId)).toBeUndefined();
	});
});
