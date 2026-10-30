import encodeQR from "qr";
import { type ReactElement, useMemo } from "react";

const QR_SIZE = 180;
/** The quiet zone ISO/IEC 18004 recommends; Steam's dark background makes a narrower one unreliable. */
const QR_BORDER_MODULES = 4;

type QrVector = Readonly<{ path: string; size: number }>;

function createQrVector(url: string): QrVector {
	const modules = encodeQR(url, "raw", { border: QR_BORDER_MODULES });
	let path = "";

	for (const [y, row] of modules.entries()) {
		for (const [x, isDark] of row.entries()) {
			if (isDark) {
				path += `M${x} ${y}h1v1H${x}z`;
			}
		}
	}

	return { path, size: modules.length };
}

export function ActivitySettingsQrCode({
	url,
}: Readonly<{ url: string }>): ReactElement {
	const { path, size } = useMemo(() => createQrVector(url), [url]);

	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width={QR_SIZE}
			height={QR_SIZE}
			viewBox={`0 0 ${size} ${size}`}
			shapeRendering="crispEdges"
		>
			<title>QR code for the Activity access-tokens page</title>

			<rect width="100%" height="100%" fill="#FFFFFF" />

			<path d={path} fill="#000000" />
		</svg>
	);
}
