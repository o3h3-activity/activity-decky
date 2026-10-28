import type { ReactElement } from "react";

type PreviewAvatarProps = Readonly<{
	inGame?: boolean;
}>;

export function PreviewAvatar({
	inGame = false,
}: PreviewAvatarProps): ReactElement {
	return (
		<span className="relative block size-6 shrink-0 rounded-sm bg-white/15">
			{inGame && (
				<span className="absolute -right-0.5 -bottom-0.5 size-2">
					<span className="absolute inset-0 rounded-full bg-[#90ba3c] motion-safe:animate-status-ping" />

					<span className="absolute inset-0 rounded-full bg-[#90ba3c] ring-2 ring-[#252a32]" />
				</span>
			)}
		</span>
	);
}
