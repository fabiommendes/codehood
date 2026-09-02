/**
 * A small, deliberately non-exhaustive mapping between MIME types and file
 * extensions, covering what a course is likely to push (`manage
 * import-resources`) and what the blob route needs for a fallback download
 * name (see `dev/specs/to-do/resources.md`, "The download name"). An unknown
 * extension or MIME type is not an error — it just gets no extension, or
 * `application/octet-stream`.
 */
const MIME_BY_EXT: Record<string, string> = {
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
	mp3: "audio/mpeg",
	wav: "audio/wav",
	mp4: "video/mp4",
	webm: "video/webm",
	txt: "text/plain",
	md: "text/markdown",
	csv: "text/csv",
	json: "application/json",
	zip: "application/zip",
	html: "text/html",
	htm: "text/html",
};

const EXT_BY_MIME: Record<string, string> = Object.fromEntries(
	Object.entries(MIME_BY_EXT).map(([ext, mime]) => [mime, ext]),
);

/** Guesses a MIME type from a file's extension, defaulting to a generic binary type. */
export function guessMimeType(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** The conventional extension for a MIME type, or `null` if none is known. */
export function extensionForMime(mimeType: string): string | null {
	return EXT_BY_MIME[mimeType.toLowerCase()] ?? null;
}
