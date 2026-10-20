import { afterEach, describe, expect, it, vi } from "vitest";
import type { DeviceAuthorizationState } from "./account";

const boundary = vi.hoisted(() => ({
	listeners: new Map<string, (state: unknown) => void>(),
	logError: vi.fn<() => void>(),
	request: vi.fn<(name: string) => Promise<unknown>>(),
}));

vi.mock(
	import("@decky/api"),
	() =>
		({
			addEventListener: (event: string, listener: (state: unknown) => void) => {
				boundary.listeners.set(event, listener);

				return listener;
			},
			callable: (name: string) => async () => boundary.request(name),
			removeEventListener: (event: string) => {
				boundary.listeners.delete(event);
			},
		}) as never,
);

vi.mock(
	import("@utils/logger"),
	() => ({ default: { error: boundary.logError } }) as never,
);

const { getDeviceAuthorization, onDeviceAuthorizationChanged } = await import(
	"./account"
);

const valid: DeviceAuthorizationState = {
	accessTokensUrl: "https://activity.example/tokens",
	codeExpiresAt: 0,
	message: "",
	retroAchievementsLinked: false,
	status: "pending",
	tokenExpiresAt: "",
	userCode: "ABCD-EFGH",
	verificationUri: "https://activity.example/device",
	verificationUriComplete: "https://activity.example/device?code=ABCD-EFGH",
};

const malformed: [string, unknown][] = [
	// oxlint-disable-next-line unicorn/no-null -- A backend bug can serialise None.
	["null", null],
	["a string", "signedIn"],
	["an unknown status", { ...valid, status: "authorized" }],
	["a missing field", { ...valid, userCode: undefined }],
	["a non-numeric code expiry", { ...valid, codeExpiresAt: "0" }],
	[
		"a non-boolean RetroAchievements link",
		{ ...valid, retroAchievementsLinked: 0 },
	],
];

afterEach(() => {
	vi.clearAllMocks();
	boundary.listeners.clear();
});

describe("device authorization boundary validation", () => {
	it("returns a well-formed backend state", async () => {
		boundary.request.mockResolvedValue(valid);

		expect(await getDeviceAuthorization()).toEqual(valid);
	});

	it.each(malformed)("rejects %s as a failed RPC", async (_, payload) => {
		boundary.request.mockResolvedValue(payload);

		await expect(getDeviceAuthorization()).rejects.toBeInstanceOf(TypeError);
	});

	it.each(malformed)("drops an event carrying %s", (_, payload) => {
		const listener = vi.fn<(state: DeviceAuthorizationState) => void>();

		onDeviceAuthorizationChanged(listener);
		boundary.listeners.get("device_authorization_changed")?.(payload);

		expect(listener).not.toHaveBeenCalled();
		expect(boundary.logError).toHaveBeenCalledOnce();
	});

	it("forwards valid events until unsubscribed", () => {
		const listener = vi.fn<(state: DeviceAuthorizationState) => void>();
		const unsubscribe = onDeviceAuthorizationChanged(listener);

		boundary.listeners.get("device_authorization_changed")?.(valid);
		unsubscribe();

		expect(listener).toHaveBeenCalledExactlyOnceWith(valid);
		expect(boundary.listeners.size).toBe(0);
	});
});
