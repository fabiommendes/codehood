/**
 * A small, deliberately non-exhaustive mapping between MIME types and file
 * extensions, covering what a course is likely to push (`manage
 * import-resources`) and what the application needs when it serves a blob
 * itself.
 *
 * It does not have to agree with any reverse-proxy configuration: a proxy
 * reads a real filename off disk and consults its own, far larger table (see
 * `dev/specs/to-do/blob-attachments.md`). An unknown extension or MIME type is
 * not an error — it just gets no extension, or `application/octet-stream`.
 *
 * Keys are lowercase and carry their leading dot.
 */
export const MIME_BY_EXTENSION: Record<string, string> = {
	".pdf": "application/pdf",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".avif": "image/avif",
	".svg": "image/svg+xml",
	".mp3": "audio/mpeg",
	".ogg": "audio/ogg",
	".wav": "audio/wav",
	".mp4": "video/mp4",
	".webm": "video/webm",
	".txt": "text/plain",
	".md": "text/markdown",
	".mdq": "text/markdown",
	".csv": "text/csv",
	".json": "application/json",
	".zip": "application/zip",
	".html": "text/html",
	".htm": "text/html",
};

const EXTENSION_BY_MIME: Record<string, string> = {};
for (const [extension, mime] of Object.entries(MIME_BY_EXTENSION)) {
	if (!(mime in EXTENSION_BY_MIME)) {
		EXTENSION_BY_MIME[mime] = extension.slice(1);
	}
}

/**
 * The lowercase extension of `filename` including its dot, or `null`.
 */
export function extensionOf(filename: string): string | null {
	const index = filename.lastIndexOf(".");
	if (index === -1 || index === filename.length - 1) {
		return null;
	}
	return filename.slice(index).toLowerCase();
}

/**
 * The mime type from file name.
 *
 * Can provide a default value, if mime is not found in the registry.
 *
 * Falling back to `application/octet-stream`.
 */
export function mimeFor(
	filename: string,
	defaultValue?: string | null,
): string {
	const extension = extensionOf(filename);
	if (extension) {
		return (
			MIME_BY_EXTENSION[extension] ?? defaultValue ?? "application/octet-stream"
		);
	}
	return defaultValue ?? "application/octet-stream";
}

/**
 * Guesses a MIME type from a file's extension, defaulting to a generic binary type.
 */
export function guessMimeType(filename: string): string {
	const extension = filename.split(".").pop()?.toLowerCase() ?? "";
	return MIME_BY_EXTENSION[`.${extension}`] ?? "application/octet-stream";
}

/**
 * The conventional extension for a MIME type, or `null` if none is known.
 */
export function extensionForMime(mimeType: string): string | null {
	return EXTENSION_BY_MIME[mimeType.toLowerCase()] ?? null;
}
