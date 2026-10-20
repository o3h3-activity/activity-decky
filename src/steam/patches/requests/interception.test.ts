import type { callOriginal, findModule, replacePatch } from "@decky/ui";
import type { Games } from "@steam/games";
import { SteamPartnerEventRoute } from "@steam/patches/eventsAndAnnouncements/eventRoutes";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import type { AppStore } from "@steam/proxy/appStore";
import type { SteamAjaxRequestConfig } from "@typings/steamAjaxRequest";
import logger from "@utils/logger";
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";
import { SteamAxiosPatcher } from "./axios";
import { SteamFetchPatcher } from "./fetch";
import { type RedirectRoute, SteamRequestPatcher } from "./requestPatcher";

type DeckyUiModule = {
	callOriginal: typeof callOriginal;
	findModule: typeof findModule;
	replacePatch: typeof replacePatch;
};
type NativeResponse = Response | { native: boolean };
type NativeCall = (...args: unknown[]) => Promise<NativeResponse>;
type InterceptionHarness = {
	clans: { has: Mock<(clanId: number) => boolean> };
	games: { isSupported: Mock<(appId: number) => boolean> };
	invoke: (...args: unknown[]) => unknown;
	nativeResponse: NativeResponse;
	original: Mock<NativeCall>;
	patcher: SteamRequestPatcher;
	route: {
		matchUrl: Mock<RedirectRoute["matchUrl"]>;
		resolve: Mock<RedirectRoute["resolve"]>;
	};
};

const mocks = vi.hoisted(() => ({
	findModule: vi.fn<() => unknown>(),
	isAppShortcut: vi.fn<(appId: number) => boolean>(() => true),
}));

vi.mock(import("@decky/ui"), () => {
	const callOriginal = Symbol("callOriginal");

	return {
		callOriginal,
		findModule: mocks.findModule,
		replacePatch: (
			target: { get: (...args: unknown[]) => unknown },
			_method: string,
			callback: (this: unknown, args: unknown[]) => unknown,
		) => {
			const original = target.get;

			target.get = function (this: unknown, ...args: unknown[]) {
				const result = callback.call(this, args);

				return result === callOriginal ? original.apply(this, args) : result;
			};

			return {
				original,
				unpatch: () => {
					target.get = original;
				},
			};
		},
	} as unknown as DeckyUiModule;
});

vi.mock(
	import("@steam/proxy/appStore"),
	() =>
		({
			AppStore: { isAppShortcut: mocks.isAppShortcut },
		}) as unknown as { AppStore: typeof AppStore },
);

vi.mock(
	import("@utils/logger"),
	() =>
		({
			default: {
				debug: vi.fn<(...args: unknown[]) => void>(),
				error: vi.fn<(...args: unknown[]) => void>(),
			},
		}) as unknown as { default: typeof logger },
);

const patchers: SteamRequestPatcher[] = [];
const url = "https://steam.test/events/ajaxgetpartnerevent?appid=1";
const localError = new Error("local failure");
const receiver = { caller: "Steam" };

function setup(
	adapter: "axios" | "fetch",
	routes?: readonly RedirectRoute[],
): InterceptionHarness {
	const route = {
		matchUrl: vi.fn<RedirectRoute["matchUrl"]>(() => ({
			appId: 1,
			shouldBeRedirected: true,
		})),
		resolve: vi.fn<RedirectRoute["resolve"]>(async () => ({ success: 1 })),
	};
	const games = { isSupported: vi.fn<(appId: number) => boolean>(() => true) };
	const clans = { has: vi.fn<(clanId: number) => boolean>(() => true) };
	const nativeResponse =
		adapter === "fetch" ? new Response("native") : { native: true };
	const original = vi.fn<NativeCall>(() => Promise.resolve(nativeResponse));
	const target = { get: original as (...args: unknown[]) => unknown };
	let patcher: SteamRequestPatcher;
	let invoke: (...args: unknown[]) => unknown;

	if (adapter === "fetch") {
		vi.stubGlobal("window", { fetch: original });
		patcher = new SteamFetchPatcher(
			routes ?? [route],
			clans as unknown as ShortcutClanRegistry,
			games as unknown as Games,
		);

		invoke = (...args) => Reflect.apply(window.fetch, receiver, args);
	} else {
		mocks.findModule.mockReturnValue(target);
		patcher = new SteamAxiosPatcher(
			routes ?? [route],
			clans as unknown as ShortcutClanRegistry,
			games as unknown as Games,
		);

		invoke = (...args) => target.get.apply(receiver, args);
	}

	patchers.push(patcher);

	return {
		route,
		games,
		clans,
		nativeResponse,
		original,
		patcher,
		invoke,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.isAppShortcut.mockReturnValue(true);
});

afterEach(() => {
	for (const patcher of patchers.splice(0)) {
		patcher.unMount();
	}

	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

for (const adapter of ["fetch", "axios"] as const) {
	describe(`${adapter} interception failures`, () => {
		it.each(["matcher", "shortcut", "support", "clan"] as const)(
			"passes through exactly once when the local %s throws",
			async (failure) => {
				const h = setup(adapter);
				const fail = (): never => {
					throw localError;
				};

				if (failure === "matcher") {
					h.route.matchUrl.mockImplementation(fail);
				}

				if (failure === "shortcut") {
					mocks.isAppShortcut.mockImplementation(fail);
				}

				if (failure === "support") {
					h.games.isSupported.mockImplementation(fail);
				}

				if (failure === "clan") {
					h.route.matchUrl.mockReturnValue({
						clanAccountId: 1,
						shouldBeRedirected: true,
					});

					h.clans.has.mockImplementation(fail);
				}

				const config = { headers: { "X-Steam": "raw" } };
				const args =
					adapter === "fetch" ? [new URL(url), config] : [url, config, "extra"];

				await expect(h.invoke(...args)).resolves.toBe(h.nativeResponse);
				expect(h.original).toHaveBeenCalledExactlyOnceWith(...args);
				expect(h.original.mock.contexts[0]).toBe(
					adapter === "fetch" ? window : receiver,
				);

				expect(h.route.resolve).not.toHaveBeenCalled();
				expect(logger.error).toHaveBeenCalledWith(
					expect.any(String),
					expect.objectContaining({ error: localError }),
				);
			},
		);

		it.each(["passthrough", "empty", "resolver", "matcher"] as const)(
			"does not retry or relabel a native error after %s",
			async (path) => {
				const h = setup(adapter);

				if (path === "passthrough") {
					h.route.matchUrl.mockReturnValue({ shouldBeRedirected: false });
				}

				if (path === "empty") {
					h.route.resolve.mockResolvedValue(undefined);
				}

				if (path === "resolver") {
					h.route.resolve.mockRejectedValue(localError);
				}

				if (path === "matcher") {
					h.route.matchUrl.mockImplementation(() => {
						throw localError;
					});
				}

				const nativeError = new Error("native failure");

				h.original.mockRejectedValue(nativeError);

				await expect(Promise.resolve().then(() => h.invoke(url))).rejects.toBe(
					nativeError,
				);

				expect(h.original).toHaveBeenCalledOnce();
				expect(logger.error).not.toHaveBeenCalledWith(
					expect.any(String),
					expect.objectContaining({ error: nativeError }),
				);
			},
		);

		it("does not retry a synchronous native throw after a matcher failure", async () => {
			const h = setup(adapter);

			h.route.matchUrl.mockImplementation(() => {
				throw localError;
			});

			const nativeError = new Error("synchronous native failure");

			h.original.mockImplementation(() => {
				throw nativeError;
			});

			await expect(Promise.resolve().then(() => h.invoke(url))).rejects.toBe(
				nativeError,
			);

			expect(h.original).toHaveBeenCalledOnce();
			expect(logger.error).toHaveBeenCalledOnce();
		});

		it("does not fall back if a matcher ends the session before throwing", async () => {
			const h = setup(adapter);

			h.route.matchUrl.mockImplementation(() => {
				h.patcher.unMount();

				throw localError;
			});

			await expect(
				Promise.resolve().then(() => h.invoke(url)),
			).rejects.toMatchObject({ name: "AbortError", __CANCEL__: true });

			expect(h.original).not.toHaveBeenCalled();
			expect(logger.error).not.toHaveBeenCalled();
		});

		it.each(["resolve", "reject"] as const)(
			"rejects with AbortError after logout and local %s",
			async (settlement) => {
				const h = setup(adapter);
				const pending = Promise.withResolvers<unknown>();

				h.route.resolve.mockReturnValue(pending.promise);
				const result = h.invoke(url);

				h.patcher.unMount();

				if (settlement === "resolve") {
					pending.resolve({ success: 1 });
				} else {
					pending.reject(localError);
				}

				await expect(result).rejects.toMatchObject({
					name: "AbortError",
					__CANCEL__: true,
				});

				expect(h.original).not.toHaveBeenCalled();
				expect(logger.error).not.toHaveBeenCalled();
			},
		);
	});
}

describe("fetch formatting and passthrough", () => {
	it("logs a serialization failure and calls native fetch once", async () => {
		const h = setup("fetch");

		h.route.resolve.mockResolvedValue({ event: 1n });
		const request = new Request(url);
		const init = { credentials: "include" as const };

		await expect(h.invoke(request, init)).resolves.toBe(h.nativeResponse);
		expect(h.original).toHaveBeenCalledExactlyOnceWith(request, init);
		expect(h.original.mock.contexts[0]).toBe(window);
		expect(logger.error).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ error: expect.any(TypeError) }),
		);
	});

	it("keeps native rejection outside the formatter catch", async () => {
		const h = setup("fetch");

		h.route.resolve.mockResolvedValue({ event: 1n });
		const nativeError = new Error("native failure");

		h.original.mockRejectedValue(nativeError);

		await expect(h.invoke(url)).rejects.toBe(nativeError);
		expect(h.original).toHaveBeenCalledOnce();
		expect(logger.error).toHaveBeenCalledOnce();
	});

	it.each([
		[new Request(url, { method: "POST" }), undefined],
		[new Request(url), { method: "POST" }],
	] as const)(
		"bypasses local matching for non-GET requests",
		async (input, init) => {
			const h = setup("fetch");

			h.route.matchUrl.mockImplementation(() => {
				throw localError;
			});

			await expect(h.invoke(input, init)).resolves.toBe(h.nativeResponse);
			expect(h.route.matchUrl).not.toHaveBeenCalled();
			expect(h.original).toHaveBeenCalledExactlyOnceWith(input, init);
			expect(logger.error).not.toHaveBeenCalled();
		},
	);

	it("lets init.method override a Request method with GET", async () => {
		const h = setup("fetch");
		const response = (await h.invoke(new Request(url, { method: "POST" }), {
			method: "get",
		})) as Response;

		expect(await response.json()).toEqual({ success: 1 });
		expect(h.original).not.toHaveBeenCalled();
	});

	it("restores only its own fetch wrapper and retained wrappers pass through", async () => {
		const h = setup("fetch");
		const retained = window.fetch;

		h.patcher.unMount();
		expect(window.fetch).toBe(h.original);
		await expect(retained(url)).resolves.toBe(h.nativeResponse);
		expect(h.route.matchUrl).not.toHaveBeenCalled();
		expect(h.original).toHaveBeenCalledOnce();

		const next = setup("fetch");
		const newerFetch = vi.fn<typeof fetch>();

		window.fetch = newerFetch;
		next.patcher.unMount();
		expect(window.fetch).toBe(newerFetch);
	});
});

describe("Axios cancellation", () => {
	it.each(["resolve", "reject"] as const)(
		"preserves exact %s token reasons without fallback",
		async (settlement) => {
			const h = setup("axios");
			const request = Promise.withResolvers<unknown>();
			const cancellation = Promise.withResolvers<unknown>();

			h.route.resolve.mockReturnValue(request.promise);
			const reason = { __CANCEL__: true, message: "Steam cancelled" };
			const result = h.invoke(url, {
				cancelToken: { promise: cancellation.promise },
			});

			if (settlement === "resolve") {
				cancellation.resolve(reason);
			} else {
				cancellation.reject(reason);
			}

			await expect(result).rejects.toBe(reason);
			request.resolve({ success: 1 });
			expect(h.original).not.toHaveBeenCalled();
			expect(logger.error).not.toHaveBeenCalled();
		},
	);
});

class FormattedRequestPatcher extends SteamRequestPatcher {
	constructor(
		target: object,
		format: (data: unknown, config?: SteamAjaxRequestConfig) => unknown,
	) {
		super(
			[SteamPartnerEventRoute],
			"FormattedRequestPatcher",
			{ has: () => false } as unknown as ShortcutClanRegistry,
			{ isSupported: () => true } as unknown as Games,
		);

		this.patchGet(target, format);
	}
}

describe("partner-event response formatting", () => {
	it("returns a successful missing event without logging or falling back", async () => {
		const h = setup("axios", [SteamPartnerEventRoute]);

		await expect(h.invoke(url)).resolves.toMatchObject({
			// oxlint-disable-next-line unicorn/no-null
			data: { event: null, success: 1 },
			status: 200,
		});

		expect(h.original).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("logs formatter failure as exceptional fallback, not a missing event", async () => {
		const original = vi.fn<(...args: unknown[]) => string>(
			() => "native-event",
		);
		const target = { get: original as (...args: unknown[]) => unknown };
		const patcher = new FormattedRequestPatcher(target, (data) => {
			// oxlint-disable-next-line unicorn/no-null
			expect(data).toEqual({ event: null, success: 1 });

			throw localError;
		});

		patchers.push(patcher);
		const config = { params: { appid: 1 } };
		const args = [url, config, "extra"];

		await expect(target.get.apply(receiver, args)).resolves.toBe(
			"native-event",
		);

		expect(original).toHaveBeenCalledExactlyOnceWith(...args);
		expect(original.mock.contexts[0]).toBe(receiver);
		expect(logger.error).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ error: localError, url, config }),
		);
	});

	it("does not fall back if formatting ends the session before throwing", async () => {
		const original = vi.fn<(...args: unknown[]) => unknown>();
		const target = { get: original as (...args: unknown[]) => unknown };
		const patcher = new FormattedRequestPatcher(target, () => {
			patcher.unMount();

			throw localError;
		});

		patchers.push(patcher);

		await expect(target.get(url)).rejects.toMatchObject({
			name: "AbortError",
			__CANCEL__: true,
		});

		expect(original).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});
});
