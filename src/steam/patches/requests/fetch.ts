import type { Games } from "@steam/games";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import { type RedirectRoute, SteamRequestPatcher } from "./requestPatcher";

/**
 * Redirects matching GET requests made through `window.fetch`.
 *
 * Steam's clan lookup checks `response.ok` and calls `response.json()`.
 * Route data must therefore be JSON in a real 200 `Response`, not a plain
 * object. Other requests use the original fetch.
 *
 * Cleanup restores fetch only if our wrapper is still installed; otherwise
 * it would overwrite a replacement installed later by Steam or another plugin.
 */
export class SteamFetchPatcher extends SteamRequestPatcher {
	constructor(
		routes: readonly RedirectRoute[],
		shortcutClans: ShortcutClanRegistry,
		games: Games,
	) {
		super(routes, "SteamFetchPatcher", shortcutClans, games);

		this.patchFetch();
	}

	private patchFetch(): void {
		// Keep the exact identity for restoration; invoke with window below.
		const fetchTarget: { fetch: typeof fetch } = window;
		const originalFetch = fetchTarget.fetch;
		const patchedFetch = async (
			input: RequestInfo | URL,
			init?: RequestInit,
		): Promise<Response> => {
			let url: string;

			if (typeof input === "string") {
				url = input;
			} else if (input instanceof URL) {
				url = input.href;
			} else {
				url = input.url;
			}

			const method = (
				init?.method ?? (input instanceof Request ? input.method : "GET")
			).toUpperCase();

			const matched = method === "GET" ? this.tryMatchRedirect(url) : undefined;

			if (!matched) {
				return originalFetch.call(window, input, init);
			}

			return this.redirect(
				matched,
				() => originalFetch.call(window, input, init),
				(data: unknown) =>
					new Response(JSON.stringify(data), {
						headers: { "Content-Type": "application/json" },
						status: 200,
					}),
			);
		};

		window.fetch = patchedFetch;

		this.scope.addDisposer(() => {
			if (window.fetch === patchedFetch) {
				window.fetch = originalFetch;
			}
		});
	}
}
