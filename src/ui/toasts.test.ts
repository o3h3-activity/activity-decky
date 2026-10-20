import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";

const BEFORE_FIRST_COOLDOWN_END = 29_999;
const FIRST_COOLDOWN_END = 30_000;
const BEFORE_SECOND_COOLDOWN_END = 59_999;

const boundary = vi.hoisted(() => ({
	toast: vi.fn<(message: { body: string; title: string }) => void>(),
}));

vi.mock(
	import("@decky/api"),
	() => ({ toaster: { toast: boundary.toast } }) as never,
);

let clock: MockInstance<() => number>;
const openSignIn = (): void => undefined;

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	clock = vi.spyOn(performance, "now").mockReturnValue(0);
});

afterEach(() => vi.restoreAllMocks());

describe("sign-in required toast", () => {
	it("drops repeats until exactly 30 seconds after the last shown toast", async () => {
		const { showSignInRequiredToast } = await import("./toasts");

		showSignInRequiredToast(openSignIn);
		expect(boundary.toast.mock.calls[0]?.[0].body).toMatch(/sign in/iu);

		clock.mockReturnValue(BEFORE_FIRST_COOLDOWN_END);
		showSignInRequiredToast(openSignIn);
		expect(boundary.toast).toHaveBeenCalledOnce();

		clock.mockReturnValue(FIRST_COOLDOWN_END);
		showSignInRequiredToast(openSignIn);
		expect(boundary.toast).toHaveBeenCalledTimes(2);

		clock.mockReturnValue(BEFORE_SECOND_COOLDOWN_END);
		showSignInRequiredToast(openSignIn);
		expect(boundary.toast).toHaveBeenCalledTimes(2);
	});
});
