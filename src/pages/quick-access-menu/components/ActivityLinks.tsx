/* oxlint-disable react/forbid-component-props */
import { QrCode } from "@components/QrCode";
import {
	DialogBody,
	DialogBodyText,
	DialogButton,
	DialogHeader,
	Field,
	Focusable,
	ModalRoot,
	Navigation,
	PanelSection,
	PanelSectionRow,
	showModal,
} from "@decky/ui";
import type { CSSProperties, ReactElement } from "react";
import { HiQrCode } from "react-icons/hi2";
import { MdGamepad } from "react-icons/md";
import { SiDiscord, SiGithub, SiKofi } from "react-icons/si";

const LINK_ROW_STYLE: CSSProperties = {
	display: "flex",
	alignItems: "center",
	gap: "8px",
	width: "100%",
	paddingTop: "8px",
};

const LINK_ICON_STYLE: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	flexShrink: 0,
	width: "24px",
	fontSize: "24px",
};

const LINK_BUTTON_STYLE = {
	flex: 1,
	minWidth: 0,
	padding: "10px",
	fontSize: "14px",
};

const QR_BUTTON_STYLE: CSSProperties = {
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	alignSelf: "stretch",
	flexShrink: 0,
	width: "40px",
	minWidth: 0,
	maxWidth: "40px",
	padding: "10px",
};

const QR_CONTENT_STYLE: CSSProperties = {
	display: "flex",
	flexDirection: "column",
	alignItems: "center",
	gap: "16px",
};

const QR_URL_STYLE: CSSProperties = {
	textAlign: "center",
	wordBreak: "break-all",
};

const LINKS = [
	{
		icon: <MdGamepad />,
		label: "Activity website",
		url: "https://activity.o3h3.com",
	},
	{
		icon: <SiDiscord fill="#5865F2" />,
		label: "Join the Discord",
		url: "https://discord.gg/9UK8gjrWVc",
	},
	{
		icon: <SiGithub />,
		label: "View on GitHub",
		url: "https://github.com/o3h3-activity/activity-decky",
	},
	{
		icon: <SiKofi fill="#FF5E5B" />,
		label: "Support on Ko-Fi",
		url: "https://ko-fi.com/ynhhoj",
	},
] as const;

function openLink(url: string): void {
	Navigation.CloseSideMenus();
	Navigation.NavigateToExternalWeb(url);
}

function showLinkQrCode(label: string, url: string): void {
	showModal(
		<ModalRoot>
			<DialogHeader>{label}</DialogHeader>

			<DialogBody>
				<div style={QR_CONTENT_STYLE}>
					<QrCode size={256} title={`QR code for ${label}`} url={url} />

					<DialogBodyText style={QR_URL_STYLE}>{url}</DialogBodyText>
				</div>
			</DialogBody>
		</ModalRoot>,
	);
}

export function ActivityLinks(): ReactElement {
	return (
		<PanelSection title="More">
			{LINKS.map(({ icon, label, url }) => (
				<PanelSectionRow key={url}>
					<Field
						bottomSeparator="none"
						childrenContainerWidth="max"
						inlineWrap="keep-inline"
						padding="none"
						spacingBetweenLabelAndChild="none"
					>
						<Focusable style={LINK_ROW_STYLE} flow-children="horizontal">
							<div aria-hidden style={LINK_ICON_STYLE}>
								{icon}
							</div>

							<DialogButton
								style={LINK_BUTTON_STYLE}
								onClick={() => openLink(url)}
								onSecondaryActionDescription="Show link QR code"
								onSecondaryButton={() => showLinkQrCode(label, url)}
							>
								{label}
							</DialogButton>

							<DialogButton
								aria-label={`Show QR code for ${label}`}
								onClick={() => showLinkQrCode(label, url)}
								onOKActionDescription="Show link QR code"
								style={QR_BUTTON_STYLE}
							>
								<HiQrCode />
							</DialogButton>
						</Focusable>
					</Field>
				</PanelSectionRow>
			))}
		</PanelSection>
	);
}
