import { extensionForMime } from "./mime";
import { slugify } from "./slugify";

/**
 * The download name a `FILE` resource's row links with —
 * `Resource.title`, slugified, with the extension implied by
 * `File.mimeType`. See "The download name" in
 * `dev/specs/to-do/resources.md`: the name belongs to the use (the resource),
 * not to the bytes (the file), which is why it isn't stored on `File`.
 */
export function fileDownloadName(
	resource: { title: string },
	file: { mimeType: string },
): string {
	const base = slugify(resource.title);
	const ext = extensionForMime(file.mimeType);
	return ext ? `${base}.${ext}` : base;
}

/**
 * The URL for a blob: `/files/<slugHash>/<name>`, or `/files/<slugHash>` with
 * no decorative name segment. The route resolves purely on `slugHash` either
 * way — the name is a courtesy for the browser's save dialog and the
 * `Content-Disposition` fallback, not part of the address.
 */
export function blobHref(
	file: { slugHash: string },
	downloadName?: string,
): string {
	return downloadName
		? `/files/${file.slugHash}/${downloadName}`
		: `/files/${file.slugHash}`;
}
