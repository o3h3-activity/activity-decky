import { DialogBody } from "@decky/ui";
import type { ReactElement, ReactNode } from "react";

export function PageBody({
	children,
}: Readonly<{ children: ReactNode }>): ReactElement {
	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
			<div className="my-auto">
				<DialogBody>{children}</DialogBody>
			</div>
		</div>
	);
}
