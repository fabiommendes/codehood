import { InvalidData } from "@/core/error";
import { slugify } from "./slugify";

const ONLY_DOTS_RE = /^\.+$/;
const EXTENSION_RE = /^[a-z0-9]+$/i;
const BLOB_HASH_RE = /^[0-9a-f]{64}$/;
const MAX_BYTES = 255;

function reject(name: string, reason: string): never {
	throw new InvalidData(
		{ filename: [{ code: "invalid", message: reason }] },
		{ message: `"${name}" is not a valid filename: ${reason}` },
	);
}

/**
 * Reduces a client-supplied filename to a safe basename, or rejects it.
 *
 * The result names a file inside a blob's directory and is the last segment
 * of that blob's URL, so it is validated rather than trusted. Structural
 * violations throw `InvalidData`; everything else is normalised silently and
 * echoed back to the caller by the create response.
 */
export function sanitizeFilename(name: string): string {
	if (name.trim().length === 0) {
		reject(name, "Filename is empty or whitespace-only.");
	}
	if (name.includes("\0")) {
		reject(name, "Filename contains a NUL byte.");
	}
	if (name.includes("/") || name.includes("\\")) {
		reject(name, "Filename contains a path separator.");
	}
	if (ONLY_DOTS_RE.test(name)) {
		reject(name, "Filename is only dots.");
	}

	const normalized = name.normalize("NFC");
	const dotIndex = normalized.lastIndexOf(".");

	let stem: string;
	let extension: string | null = null;
	if (dotIndex === -1) {
		stem = normalized;
	} else {
		const candidate = normalized.slice(dotIndex + 1);
		if (
			candidate.length >= 1 &&
			candidate.length <= 16 &&
			EXTENSION_RE.test(candidate)
		) {
			stem = normalized.slice(0, dotIndex);
			extension = candidate.toLowerCase();
		} else {
			stem = normalized;
		}
	}

	let slug = slugify(stem);
	if (slug.length === 0) {
		slug = "file";
	}

	const suffixBytes = extension ? 1 + Buffer.byteLength(extension, "utf8") : 0;
	const available = MAX_BYTES - suffixBytes;
	while (Buffer.byteLength(slug, "utf8") > available && slug.length > 0) {
		slug = slug.slice(0, -1);
	}
	// Truncation can stop on a separator that `slugify` would have trimmed,
	// which would make a second pass over the result return something else.
	slug = slug.replace(/-+$/, "");
	if (slug.length === 0) {
		slug = "file";
	}

	const result = extension ? `${slug}.${extension}` : slug;

	if (BLOB_HASH_RE.test(result)) {
		reject(name, "Filename collides with a blob's own canonical hash entry.");
	}

	return result;
}
