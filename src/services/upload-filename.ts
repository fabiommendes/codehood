import { matchesExtensions } from "mdq";
import { InvalidData } from "@/core/error";
import { m } from "@/i18n";
import { sanitizeFilename } from "@/utils/filename";

const MAX_BYTES = 255;

/**
 * The name a file of an upload question is stored under, or `InvalidData` when the question does not accept it.
 *
 * With `extensions`, the longest one that matches the raw name is kept, lower-cased, and the rest is sanitized and cut so the whole stays within 255 bytes; without, it is `sanitizeFilename`. The result is its own fixed point.
 *
 * @throws {@link InvalidData} If the name matches no extension or is not a valid filename.
 */
export function uploadFilename(
	name: string,
	question: { extensions?: readonly string[] | null },
): string {
	const { extensions } = question;
	if (extensions === undefined || extensions === null) {
		return sanitizeFilename(name);
	}
	const extension = [...extensions]
		.sort((a, b) => b.length - a.length)
		.find((candidate) => matchesExtensions({ extensions: [candidate] }, name));
	if (extension === undefined) {
		throw new InvalidData({
			filename: [
				{ code: "invalid", message: m.errors_upload_extension_not_accepted() },
			],
		});
	}
	const suffix = extension.toLowerCase();
	const stem = name.slice(0, name.length - extension.length);
	// The placeholder keeps `sanitizeFilename` from reading a dotted stem as a name with an extension.
	let slug = sanitizeFilename(`${stem}.x`).slice(0, -2);
	// An extension is ASCII by the mdq grammar, so its length is its size in bytes.
	slug = truncateBytes(slug, MAX_BYTES - suffix.length);
	slug = slug.replace(/-+$/, "");
	return `${slug || "file"}${suffix}`;
}

/// The longest prefix of `text` that fits in `limit` UTF-8 bytes, never splitting a code point.
function truncateBytes(text: string, limit: number): string {
	const encoder = new TextEncoder();
	let used = 0;
	let end = 0;
	for (const char of text) {
		used += encoder.encode(char).length;
		if (used > limit) break;
		end += char.length;
	}
	return text.slice(0, end);
}
