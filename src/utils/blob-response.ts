import { InvalidData, NotFound } from "@/core/error";

/**
 * How a resource blob is served — an allowlist rather than a blocklist.
 * The blob sits on the app's own origin with no auth in front of it: an
 * instructor pushing an `.html` file would otherwise be pushing a script that
 * runs with every student's session cookie. SVG is carved out of `image/*`
 * for the same reason, wearing an image MIME type.
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

/// `encodeURIComponent` plus the characters RFC 5987 leaves out of `attr-char`.
function encodeExtValue(value: string): string {
	return encodeURIComponent(value).replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

/**
 * The `Content-Disposition` of a blob: inline for the safe types, attachment otherwise.
 *
 * A name outside printable ASCII goes in `filename` with `_` in place of those
 * characters, and exactly as `filename*` (RFC 5987).
 */
export function contentDisposition(mimeType: string, filename: string): string {
	const disposition = isInlineMimeType(mimeType) ? "inline" : "attachment";
	const ascii = filename.replace(/[^\x20-\x7e]/g, "_");
	const base = `${disposition}; filename="${escapeFilename(ascii)}"`;
	return ascii === filename
		? base
		: `${base}; filename*=UTF-8''${encodeExtValue(filename)}`;
}

/** The security headers every blob response and every page linking to one carries. */
export function blobSecurityHeaders(): Record<string, string> {
	return {
		"X-Content-Type-Options": "nosniff",
		"Referrer-Policy": "no-referrer",
	};
}

/** A 404 with the blob security headers, the same for a missing and a denied file. */
export function notFoundResponse(): Response {
	return new Response("Not found", {
		status: 404,
		headers: { "Content-Type": "text/plain", ...blobSecurityHeaders() },
	});
}

/**
 * Serves the attachment `load` returns, or a 404 when it is missing, denied or addressed by a malformed path.
 */
export async function attachmentResponse(
	load: () => Promise<{ bytes: Buffer; mimeType: string; filename: string }>,
): Promise<Response> {
	try {
		const file = await load();
		return new Response(new Uint8Array(file.bytes), {
			status: 200,
			headers: {
				"Content-Type": file.mimeType,
				"Content-Disposition": contentDisposition(file.mimeType, file.filename),
				...blobSecurityHeaders(),
			},
		});
	} catch (error) {
		if (error instanceof NotFound || error instanceof InvalidData) {
			return notFoundResponse();
		}
		throw error;
	}
}

/**
 * The last segment of the request path, percent-decoded exactly once.
 *
 * Astro decodes a path until nothing is left to decode, so a name with a
 * literal `%20` reaches a route as a space; the request URL still has it raw.
 */
export function lastPathSegment(request: Request): string | undefined {
	const raw = new URL(request.url).pathname.split("/").pop();
	if (!raw) return undefined;
	try {
		return decodeURIComponent(raw);
	} catch {
		return undefined;
	}
}
