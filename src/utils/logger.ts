type MessageLogger = (message: string, ...args: unknown[]) => void;
type OnceMessageLogger = MessageLogger & {
	clear: () => void;
};

const oncePerMessage = (
	logger: MessageLogger,
	isEnabled?: () => boolean,
): OnceMessageLogger => {
	let loggedMessages = new Set<string>();

	const logOnce: OnceMessageLogger = (message: string, ...args: unknown[]) => {
		if (isEnabled !== undefined && !isEnabled()) {
			return;
		}

		if (loggedMessages.has(message)) {
			return;
		}

		loggedMessages.add(message);
		logger(message, ...args);
	};

	logOnce.clear = () => {
		loggedMessages = new Set();
	};

	return logOnce;
};

/**
 * Default debug state, resolved at build time: `process.env.NODE_ENV` is
 * statically replaced by rollup (`@rollup/plugin-replace`, defaulting to
 * `"production"`), so dev builds default to `true` and production builds to
 * `false`. The persisted `isDebugEnabled` Decky setting overrides this at
 * runtime through `setDebugEnabled`.
 */
const DEFAULT_DEBUG_ENABLED = process.env.NODE_ENV !== "production";

let debugEnabled = DEFAULT_DEBUG_ENABLED;

export const isDebugEnabled = (): boolean => debugEnabled;

export const setDebugEnabled = (enabled: boolean): void => {
	debugEnabled = enabled;
};

export const log = (...args: unknown[]): void => {
	console.log(
		"%c Activity %c",
		"background: #16a085; color: black;",
		"background: #1abc9c; color: black;",
		...args,
	);
};

export const debug = (...args: unknown[]): void => {
	if (!debugEnabled) {
		return;
	}

	console.debug(
		// oxlint-disable-next-line unicorn/no-console-spaces
		"%c Activity %c DEBUG ",
		"background: #16a085; color: black;",
		"background: #d6b600; color: black;",
		...args,
	);
};

export const error = (...args: unknown[]): void => {
	console.error(
		// oxlint-disable-next-line unicorn/no-console-spaces
		"%c Activity %c ERROR ",
		"background: #16a085; color: black;",
		"background: #FF000040;",
		...args,
	);
};

const onceLoggers = {
	info: oncePerMessage(log),
	debug: oncePerMessage(debug, isDebugEnabled),
	error: oncePerMessage(error),
};

const logger = {
	info: (...args: unknown[]) => {
		log(...args);
	},

	debug: (...args: unknown[]) => {
		debug(...args);
	},

	error: (...args: unknown[]) => {
		error(...args);
	},

	isDebugEnabled,
	setDebugEnabled,

	once: {
		info: onceLoggers.info,
		debug: onceLoggers.debug,
		error: onceLoggers.error,
		clear() {
			onceLoggers.info.clear();
			onceLoggers.debug.clear();
			onceLoggers.error.clear();
		},
	},
};

export default logger;
