import { Field, PanelSectionRow } from "@decky/ui";
import { DAY_MS, formatLongDate, formatRelativeTime } from "@utils/time";
import { type ReactElement, useEffect, useState } from "react";

const EXPIRY_WARNING_DAYS = 7;
const EXPIRY_WARNING_MS = EXPIRY_WARNING_DAYS * DAY_MS;
const REFRESH_INTERVAL_MS = 60_000;

/** Relative expiry with the locale date beneath; highlighted in the last week. */
export function AccessExpiryField({
	tokenExpiresAt,
}: Readonly<{ tokenExpiresAt: string }>): null | ReactElement {
	const [now, setNow] = useState(Date.now);

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), REFRESH_INTERVAL_MS);

		return () => clearInterval(interval);
	}, []);

	const expiresAt = Date.parse(tokenExpiresAt);

	if (Number.isNaN(expiresAt)) {
		// oxlint-disable-next-line unicorn/no-null
		return null;
	}

	const remaining = expiresAt - now;
	const isSoon = remaining < EXPIRY_WARNING_MS;
	const date = formatLongDate(expiresAt);
	let description = date;
	let valueClassName: string | undefined;

	if (isSoon) {
		description = `${date}. Sign in again once it expires.`;
		valueClassName = "font-bold text-amber-400";
	}

	return (
		<PanelSectionRow>
			<Field
				bottomSeparator="none"
				description={description}
				label="Access expires"
			>
				<span className={valueClassName}>{formatRelativeTime(remaining)}</span>
			</Field>
		</PanelSectionRow>
	);
}
