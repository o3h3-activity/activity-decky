import { Spinner } from "@decky/ui";
import { formatCountdown } from "@utils/time";
import { type ReactElement, useEffect, useState } from "react";

const REFRESH_INTERVAL_MS = 1000;

/** Spinner plus the time left on the sign-in code; `codeExpiresAt` 0 hides the countdown. */
export function WaitingForApproval({
	codeExpiresAt,
}: Readonly<{ codeExpiresAt: number }>): ReactElement {
	const [now, setNow] = useState(Date.now);

	useEffect(() => {
		if (codeExpiresAt === 0) {
			return;
		}

		// oxlint-disable-next-line react/set-state-in-effect
		setNow(Date.now());
		const interval = setInterval(() => setNow(Date.now()), REFRESH_INTERVAL_MS);

		return () => clearInterval(interval);
	}, [codeExpiresAt]);

	return (
		<div className="flex items-center gap-2 text-sm opacity-80">
			<span className="inline-flex size-5 [&>svg]:size-full">
				<Spinner />
			</span>

			<span>
				Waiting for approval…
				{codeExpiresAt > 0 &&
					` Code expires in ${formatCountdown(codeExpiresAt - now)}.`}
			</span>
		</div>
	);
}
