import { renderSVG } from "uqr";

/**
 * Renders the QR code of the check-in link for `code` as an SVG string.
 *
 * The link is absolute, built on `origin`, so a phone camera opens it directly.
 */
export function checkInQrSvg(
	origin: string,
	rollCallId: number,
	code: string,
): string {
	return renderSVG(`${origin}/c/${rollCallId}/${code}`, { ecc: "M" });
}
