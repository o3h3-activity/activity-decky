import { isNil } from "es-toolkit";

/** Characters a backslash escapes inside a double-quoted POSIX shell string. */
const DOUBLE_QUOTE_ESCAPABLE = new Set(['"', "\\", "$", "`"]);

/** Wine maps the `Z:` drive onto the Linux filesystem root. */
const WINE_ROOT_DRIVE = /^[Zz]:[/\\]/u;

/** ROM file extensions supported by the native identity and achievements APIs. */
export const SUPPORTED_ROM_EXTENSIONS: ReadonlySet<string> = new Set([
	".bin",
	".cue",
	".iso",
	".mdf",
	".pbp",
]);

/** `--flag=value` / `-f=value` / `ENV_VAR=value`: the value may be a path. */
const ASSIGNMENT_PREFIX = /^(?:-{1,2}[\w-]+|[A-Z_a-z]\w*)=/u;

type QuoteState = {
	escapeNext: boolean;
	quote: Nullable<"'" | '"'>;
};

/**
 * Consumes one character inside a quoted or escaped context. Returns the text to
 * append to the current argument, or `undefined` when the character is not
 * quoted/escaped and the caller must handle it.
 */
function consumeQuoted(state: QuoteState, char: string): Nullable<string> {
	if (state.escapeNext) {
		state.escapeNext = false;

		// Inside double quotes a backslash only escapes shell-special characters.
		return state.quote === '"' && !DOUBLE_QUOTE_ESCAPABLE.has(char)
			? `\\${char}`
			: char;
	}

	if (state.quote === "'") {
		if (char === "'") {
			state.quote = undefined;

			return "";
		}

		return char;
	}

	if (char === "\\") {
		state.escapeNext = true;

		return "";
	}

	if (state.quote === '"') {
		if (char === '"') {
			state.quote = undefined;

			return "";
		}

		return char;
	}

	if (char === '"' || char === "'") {
		state.quote = char;

		return "";
	}

	return undefined;
}

/**
 * Splits a launch command into arguments the way a POSIX shell does: whitespace
 * separates arguments, single quotes are literal, double quotes group text and
 * honour backslash escapes of `"`, `\`, `$` and `` ` ``, and a backslash outside
 * quotes escapes the next character. Quotes may appear mid-argument, so
 * `--rom="/a b.iso"` becomes `--rom=/a b.iso`. An unterminated quote extends to
 * the end of the command.
 */
export function tokenizeLaunchCommand(launchCommand: string): string[] {
	const tokens: string[] = [];
	const state: QuoteState = { escapeNext: false, quote: undefined };
	let token = "";
	let inToken = false;

	for (const char of launchCommand) {
		const quoted = consumeQuoted(state, char);

		if (!isNil(quoted)) {
			token += quoted;
			inToken = true;
		} else if (/\s/u.test(char)) {
			if (inToken) {
				tokens.push(token);
				token = "";
				inToken = false;
			}
		} else {
			token += char;
			inToken = true;
		}
	}

	if (state.escapeNext) {
		token += "\\";
	}

	if (inToken) {
		tokens.push(token);
	}

	return tokens;
}

function getExtension(path: string): string {
	const dotIndex = path.lastIndexOf(".");

	if (dotIndex <= path.lastIndexOf("/")) {
		return "";
	}

	return path.slice(dotIndex).toLowerCase();
}

/**
 * Turns one launch argument into the filesystem path it refers to, or
 * `undefined` when it cannot name a file (flags, `%command%`, relative paths
 * without a start directory).
 */
function toPath(argument: string, startDir: string): Nullable<string> {
	const assignment = ASSIGNMENT_PREFIX.exec(argument);
	const value = assignment ? argument.slice(assignment[0].length) : argument;

	if (WINE_ROOT_DRIVE.test(value)) {
		return value.slice(2).replaceAll("\\", "/");
	}

	// `~` is expanded by the backend, which knows the Deck user's home.
	if (value.startsWith("/") || value.startsWith("~/")) {
		return value;
	}

	if (
		startDir === "" ||
		value === "" ||
		value.startsWith("-") ||
		value.startsWith("%")
	) {
		return undefined;
	}

	const directory = startDir.endsWith("/") ? startDir : `${startDir}/`;

	return `${directory}${value}`;
}

export type FindGamePathOptions = {
	/** Lower-case extensions, dot included (`.iso`), that identify the game file. */
	extensions: ReadonlySet<string>;
	/** Shortcut start directory as Steam stores it (possibly quoted); resolves relative paths. */
	startDir?: string;
};

/**
 * Finds the game file in a Non-Steam shortcut launch command.
 *
 * A shortcut runs a launcher/emulator followed by flags, environment
 * assignments, `%command%` placeholders and the game itself, possibly followed
 * by more paths (log files, config files, data directories). Only arguments
 * whose extension is in `extensions` are candidates; the last one wins, since
 * launchers take the game as their final positional argument while core
 * libraries (`-L core.so`) come first. Returns `undefined` when no argument
 * matches.
 */
export function findGamePath(
	launchCommand: string,
	{ extensions, startDir = "" }: FindGamePathOptions,
): Nullable<string> {
	const resolvedStartDir = tokenizeLaunchCommand(startDir).join(" ");
	const launchArguments = tokenizeLaunchCommand(launchCommand);

	for (let index = launchArguments.length - 1; index >= 0; index--) {
		const path = toPath(launchArguments[index], resolvedStartDir);

		if (!isNil(path) && extensions.has(getExtension(path))) {
			return path;
		}
	}

	return undefined;
}
