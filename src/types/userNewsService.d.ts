/** Steam's UserNews protobuf service namespace; lists only the RPCs the plugin patches. */
export type SteamUserNewsService = {
	GetAppDetailsSpotlight: (...args: unknown[]) => unknown;
	GetUserNews: (...args: unknown[]) => unknown;
};

/** Companion service Steam now requires before merging UserNews for an app. */
export type SteamUserGameActivityService = {
	GetActivity: (...args: unknown[]) => unknown;
};

export type SteamUserNewsProtoEvent = {
	serializeBinary(): Uint8Array;
};

export type SteamUserNewsProtoEventConstructor = {
	fromObject(value: Record<string, unknown>): SteamUserNewsProtoEvent;
	prototype: {
		getClassName?: () => string;
	};
};
