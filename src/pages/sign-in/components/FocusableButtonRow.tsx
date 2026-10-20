/* oxlint-disable react/forbid-component-props */
import { Focusable } from "@decky/ui";
import type { ReactElement, ReactNode } from "react";

export function FocusableButtonRow({
	children,
}: Readonly<{ children: ReactNode }>): ReactElement {
	return (
		<Focusable flow-children="horizontal" className="mt-6 flex gap-2">
			{children}
		</Focusable>
	);
}
