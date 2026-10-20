const SECOND_MS = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const MINUTE_MS = SECONDS_PER_MINUTE * SECOND_MS;
const HOUR_MS = MINUTES_PER_HOUR * MINUTE_MS;
export const DAY_MS = HOURS_PER_DAY * HOUR_MS;
const MONTH_MS = DAYS_PER_MONTH * DAY_MS;
const YEAR_MS = DAYS_PER_YEAR * DAY_MS;

/** Largest unit first; the first whose size fits the distance wins. */
const RELATIVE_UNITS: readonly (readonly [
	Intl.RelativeTimeFormatUnit,
	number,
])[] = [
	["year", YEAR_MS],
	["month", MONTH_MS],
	["day", DAY_MS],
	["hour", HOUR_MS],
	["minute", MINUTE_MS],
];

// `undefined` locale: the Steam client's UI language, as exposed to its web runtime.
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });
const relativeTime = new Intl.RelativeTimeFormat(undefined, {
	numeric: "auto",
});

export function formatLongDate(epochMs: number): string {
	return longDate.format(epochMs);
}

/** "in 3 months", "tomorrow", "in 5 minutes"; under a minute reads as "now". */
export function formatRelativeTime(deltaMs: number): string {
	const distance = Math.abs(deltaMs);

	for (const [unit, size] of RELATIVE_UNITS) {
		if (distance >= size) {
			return relativeTime.format(Math.round(deltaMs / size), unit);
		}
	}

	return relativeTime.format(0, "second");
}

/** "9:05" for a remaining duration; negative durations clamp to "0:00". */
export function formatCountdown(remainingMs: number): string {
	const totalSeconds = Math.max(0, Math.ceil(remainingMs / SECOND_MS));
	const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
	const seconds = totalSeconds % SECONDS_PER_MINUTE;

	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
