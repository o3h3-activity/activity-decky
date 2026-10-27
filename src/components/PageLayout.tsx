import type { ReactElement, ReactNode } from "react";

type PageLayoutProps = Readonly<{
	/** A `PageBody`, optionally followed by a pinned footer. */
	children?: ReactNode;
}>;

export function PageLayout({ children }: PageLayoutProps): ReactElement {
	return (
		<div className="mt-[40px] box-border flex h-[calc(100%-40px-42px)] flex-col px-6 pt-4 pb-4 text-white">
			{children}
		</div>
	);
}
