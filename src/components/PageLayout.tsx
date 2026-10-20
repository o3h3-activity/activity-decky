import { DialogBody, DialogHeader } from "@decky/ui";
import type { ReactElement, ReactNode } from "react";

type PageLayoutProps = Readonly<{
	children?: ReactNode;
	title: string;
}>;

/**
 * Frame for full-screen plugin routes: clears Steam's 40px header and scrolls its own content.
 * `my-auto` centres short content; unlike `justify-center`, it never pushes tall content out of reach.
 */
export function PageLayout({ children, title }: PageLayoutProps): ReactElement {
	return (
		<div className="mt-[40px] box-border flex h-[calc(100%-40px)] flex-col overflow-y-auto px-6 pb-6 text-white">
			<div className="my-auto">
				<DialogHeader>{title}</DialogHeader>

				<DialogBody>{children}</DialogBody>
			</div>
		</div>
	);
}
