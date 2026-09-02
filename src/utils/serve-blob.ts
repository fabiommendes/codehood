// Shared handler behind both blob routes (`/files/[hash]` and
// `/files/[hash]/[name]`), per `dev/specs/to-do/resources.md`. No
// authentication check by design (FR-NFR-030, amended): the URL is the
// content's own hash, and nothing whose disclosure matters is meant to live
// in a resource (FR-NFR-032).
import { fileService } from "@/db/file.service";
import { blobSecurityHeaders, contentDisposition } from "./blob-response";
import { slugify } from "./slugify";

/**
 * Serves the blob named by `slugHash`. `name` is the URL's decorative
 * trailing segment (`/files/<hash>/<name>`) — used verbatim as the
 * `Content-Disposition` filename when present, since the page that links here
 * already picked it from the resource the visitor clicked; when absent, falls
 * back to a name built from any resource still pointing at the file. Answers
 * `404` for an unknown hash, `410` (naming what it can) for a tombstoned one.
 */
export async function serveBlob(
	slugHash: string | undefined,
	name: string | undefined,
): Promise<Response> {
	if (!slugHash) {
		return notFoundResponse();
	}

	const found = await fileService.findWithReferencingTitles(slugHash);
	if (!found) {
		return notFoundResponse();
	}
	const { file, resourceTitles } = found;

	if (file.deletedAt) {
		return tombstoneResponse(resourceTitles);
	}

	const bytes = await fileService.readBlob(file);
	if (!bytes) {
		// DB says live, disk disagrees — treat as not found rather than lie
		// about a body we don't have.
		return notFoundResponse();
	}

	const filename = name ?? fallbackFilename(resourceTitles);
	const headers = new Headers({
		"Content-Type": file.mimeType,
		"Content-Disposition": contentDisposition(file.mimeType, filename),
		...blobSecurityHeaders(),
	});
	return new Response(new Uint8Array(bytes), { status: 200, headers });
}

function fallbackFilename(resourceTitles: string[]): string {
	return slugify(resourceTitles[0] ?? "file");
}

function notFoundResponse(): Response {
	return new Response("Not found.", {
		status: 404,
		headers: { "Content-Type": "text/plain", ...blobSecurityHeaders() },
	});
}

function tombstoneResponse(resourceTitles: string[]): Response {
	const named =
		resourceTitles.length > 0
			? `It was linked from ${resourceTitles.map((t) => `"${t}"`).join(", ")}.`
			: "";
	const body = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>File removed</title></head>
<body style="font: 16px system-ui; max-width: 32rem; margin: 4rem auto; padding: 0 1rem;">
<h1>This file was removed</h1>
<p>The instructor removed this file from the course. ${named}</p>
</body>
</html>`;
	return new Response(body, {
		status: 410,
		headers: {
			"Content-Type": "text/html; charset=utf-8",
			...blobSecurityHeaders(),
		},
	});
}
