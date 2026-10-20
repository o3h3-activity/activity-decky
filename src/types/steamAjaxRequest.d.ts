/**
 * SteamUI's shared axios client (`window.steamAjaxRequest`, webpack module 1252).
 *
 * `get` / `post` unwrap the axios response and resolve to `response.data`.
 * `withCredentials` is always forced to `true` on the wire.
 */

export type SteamAjaxCancelToken = {
	promise: Promise<unknown>;
};

export type SteamAjaxRequestConfig = {
	cancelToken?: SteamAjaxCancelToken;
	params?: Record<string, unknown>;
	retrycount?: number;
	retrydelayMS?: number;
	withCredentials?: boolean;
};

export type SteamAjaxRequest = {
	get<T = unknown>(url: string, config?: SteamAjaxRequestConfig): Promise<T>;
	post<T = unknown>(
		url: string,
		data: unknown,
		config?: SteamAjaxRequestConfig,
	): Promise<T>;
};

declare global {
	interface Window {
		steamAjaxRequest: SteamAjaxRequest;
	}
}
