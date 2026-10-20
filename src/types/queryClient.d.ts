export type QueryCacheEntry = {
	queryKey?: unknown[];
};

export type QueryCacheEvent = {
	action?: { type: string };
	query: QueryCacheEntry;
	type: string;
};

export type SteamQueryCache = {
	subscribe: (listener: (event: QueryCacheEvent) => void) => () => void;
};

export type ExactQueryFilter = {
	exact: true;
	queryKey: readonly unknown[];
};

export type SteamQueryClient = {
	cancelQueries: (
		filter: ExactQueryFilter,
		options?: { revert: boolean },
	) => Promise<void>;
	getQueryCache: () => SteamQueryCache;
	getQueryData: (key: readonly unknown[]) => unknown;
	invalidateQueries: (options: {
		predicate: (query: QueryCacheEntry) => boolean;
	}) => unknown;
	removeQueries: (filter: ExactQueryFilter) => void;
	resetQueries: (options: {
		predicate: (query: QueryCacheEntry) => boolean;
	}) => Promise<void>;
	setQueryData: (key: readonly unknown[], data: unknown) => unknown;
};
