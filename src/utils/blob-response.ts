/**
 * How a resource blob is served — see "Serving a blob: an allowlist, not a
 * blocklist" in `dev/specs/to-do/resources.md`. An allowlist rather than a
 * blocklist because the blob sits on the app's own origin with no auth in
 * front of it: an instructor pushing an `.html` file would otherwise be
 * pushing a script that runs with every student's session cookie. SVG is
 * carved out of `image/*` for the same reason, wearing an image MIME type.
 */
const INLINE_PREFIXES = ["image/", "audio/", "video/"];
const INLINE_EXACT = new Set(["application/pdf"]);
const INLINE_EXCLUDED = new Set(["image/svg+xml"]);

export function isInlineMimeType(mimeType: string): boolean {
	const type = mimeType.toLowerCase();
	if (INLINE_EXCLUDED.has(type)) return false;
	if (INLINE_EXACT.has(type)) return true;
	return INLINE_PREFIXES.some((prefix) => type.startsWith(prefix));
}

/** Escapes a filename for the quoted-string form of a `Content-Disposition` header. */
function escapeFilename(filename: string): string {
	return filename.replace(/[\\"]/g, "\\$&");
}

export function contentDisposition(mimeType: string, filename: string): string {
	const disposition = isInlineMimeType(mimeType) ? "inline" : "attachment";
	return `${disposition}; filename="${escapeFilename(filename)}"`;
}

/** The security headers every blob response and every page linking to one carries. */
export function blobSecurityHeaders(): Record<string, string> {
	return {
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
	};
}
