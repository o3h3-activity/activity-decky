import { callOriginal, type Patch, replacePatch } from "@decky/ui";
import type { Games } from "@steam/games";
import { LifetimeScope } from "@steam/lifetimeScope";
import { isSupportedShortcut } from "@steam/patches/shortcutEligibility";
import type { ShortcutClanRegistry } from "@steam/patches/shortcuts/clanIdentity";
import type { SteamAjaxRequestConfig } from "@typings/steamAjaxRequest";
import logger from "@utils/logger";
import { isNil } from "es-toolkit";

const CANCELLED = Symbol("SteamRequestPatcher.cancelled");

export type RedirectMatch = {
	appId?: number;
	clanAccountId?: number;
	shouldBeRedirected: boolean;
};

export interface RedirectRoute {
	matchUrl: (url: string, config?: SteamAjaxRequestConfig) => RedirectMatch;
	resolve: (
		match: RedirectMatch,
		url: string,
		config?: SteamAjaxRequestConfig,
	) => Promise<unknown>;
}

export type MatchedRedirectRoute = {
	config?: SteamAjaxRequestConfig;
	match: RedirectMatch;
	route: RedirectRoute;
	url: string;
};

/**
 * Decides whether a GET request can be answered by Activity.
 *
 * Matching the URL is only the first step. An appid must belong to a
 * supported shortcut; a clan-only request must name a clan registered by
 * User News. Otherwise the original Steam request runs.
 *
 * Routes return the response body. Each client wrapper turns it into what
 * its caller expects: a plain body, an Axios response, or a fetch `Response`.
 * If matching, resolution, or formatting fails, or the route returns
 * `undefined`, we fall back to Steam.
 *
 * Cancellation is different: a cancelled request must not start a fallback
 * request. We watch Axios cancel tokens and the session's abort signal.
 * Decky RPCs cannot be stopped once sent, so late results are discarded.
 */
export abstract class SteamRequestPatcher {
	protected readonly scope: LifetimeScope;
	private readonly routes: readonly RedirectRoute[];

	protected constructor(
		routes: readonly RedirectRoute[],
		protected readonly owner: string,
		private readonly shortcutClans: ShortcutClanRegistry,
		private readonly games: Games,
	) {
		this.routes = routes;
		this.scope = new LifetimeScope(owner);
	}

	/** Pass through matching failures unless the Steam session has ended. */
	protected tryMatchRedirect(
		url: string,
		config?: SteamAjaxRequestConfig,
	): MatchedRedirectRoute | undefined {
		try {
			return this.matchRedirect(url, config);
		} catch (error) {
			this.throwIfDisposed();

			logger.error(`[${this.owner}] Route matching failed.`, {
				url,
				config,
				error,
			});

			return undefined;
		}
	}

	protected matchRedirect(
		url: string,
		config?: SteamAjaxRequestConfig,
	): MatchedRedirectRoute | undefined {
		if (this.scope.signal.aborted) {
			return undefined;
		}

		let matched: MatchedRedirectRoute | undefined;

		for (const route of this.routes) {
			const match = route.matchUrl(url, config);

			if (match.shouldBeRedirected) {
				matched = { config, match, route, url };
				break;
			}
		}

		if (isNil(matched)) {
			return undefined;
		}

		const appId = matched.match.appId;

		if (!isNil(appId)) {
			if (!isSupportedShortcut(this.games, appId)) {
				return undefined;
			}

			return matched;
		}

		if (
			isNil(matched.match.clanAccountId) ||
			!this.shortcutClans.has(matched.match.clanAccountId)
		) {
			return undefined;
		}

		return matched;
	}

	protected async redirect<T>(
		matched: MatchedRedirectRoute,
		fallback: () => PromiseLike<T> | T,
		format: (data: unknown, config?: SteamAjaxRequestConfig) => T,
	): Promise<T> {
		const cancelToken = matched.config?.cancelToken;
		let cancelReason: unknown;
		let outcome: unknown;

		try {
			const request = matched.route.resolve(
				matched.match,
				matched.url,
				matched.config,
			);

			if (isNil(cancelToken)) {
				outcome = await request;
			} else {
				const onCancel = (reason: unknown): typeof CANCELLED => {
					cancelReason = reason;

					return CANCELLED;
				};

				outcome = await Promise.race([
					request,
					cancelToken.promise.then(onCancel, onCancel),
				]);
			}
		} catch (error) {
			this.throwIfDisposed();
			logger.error(`[${this.owner}] Local route resolution failed.`, {
				url: matched.url,
				config: matched.config,
				error,
			});

			return fallback();
		}

		if (outcome === CANCELLED) {
			throw cancelReason;
		}

		this.throwIfDisposed();

		if (outcome === undefined) {
			return fallback();
		}

		logger.debug(`[${this.owner}] Local route resolved.`, { url: matched.url });

		try {
			return format(outcome, matched.config);
		} catch (error) {
			this.throwIfDisposed();
			logger.error(`[${this.owner}] Local response formatting failed.`, {
				url: matched.url,
				config: matched.config,
				error,
			});

			return fallback();
		}
	}

	/** Redirects the shared `get(url, config)` client method. */
	protected patchGet(
		target: object,
		format: (data: unknown, config?: SteamAjaxRequestConfig) => unknown = (
			data,
		) => data,
	): void {
		const matchRedirect = this.tryMatchRedirect.bind(this);
		const redirect = this.redirect.bind(this);
		const patch: Patch = replacePatch(
			target,
			"get",
			function (this: unknown, rawArgs: unknown[]) {
				const [url, config] = rawArgs as [unknown, SteamAjaxRequestConfig?];
				const matched =
					typeof url === "string" ? matchRedirect(url, config) : undefined;

				if (isNil(matched)) {
					return callOriginal;
				}

				logger.debug("[SteamRequestPatcher] GET", url);

				return redirect(
					matched,
					() => patch.original.call(this, ...rawArgs) as unknown,
					format,
				);
			},
		);

		this.scope.add(patch);
	}

	public unMount(): void {
		this.scope.unMount();
	}

	/** Decky RPC cannot be aborted; discard its result once this session ends. */
	protected throwIfDisposed(): void {
		if (this.scope.signal.aborted) {
			// Preserve fetch's AbortError and Axios's cancellation recognition.
			throw Object.assign(
				new DOMException("Steam session ended", "AbortError"),
				{
					__CANCEL__: true,
				},
			);
		}
	}
}
