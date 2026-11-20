import type { APIRoute } from "astro";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import {
	blobSecurityHeaders,
	contentDisposition,
	lastPathSegment,
	notFoundResponse,
} from "@/utils/blob-response";

export const prerender = false;

/// The types this route may open in the browser; everything else a student uploads is downloaded.
const INLINE = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
	"application/pdf",
]);

function textResponse(status: number, body: string): Response {
	return new Response(body, {
		status,
		headers: {
			"Content-Type": "text/plain",
			"Cache-Control": "private",
			...blobSecurityHeaders(),
		},
	});
}

/// Serves a file an upload answer cites to its author and to whoever may read the attempt. The blob hash reaches only the author, in the `path` of the answer to the upload, and those who may grade the attempt; every other reader gets 404 and never sees it.
export const GET: APIRoute = async ({ params, locals, request }) => {
	const { actor } = locals;
	const name = lastPathSegment(request);
	const { slug, submission } = params;
	if (!actor || !slug || !submission || !name) return notFoundResponse();
	try {
		const file = await db.response.submissionFile(
			{
				course: parseCourseParams(params as Record<string, string>),
				exam: slug,
				submission,
				name,
			},
			{ actor },
		);
		if (!file) return textResponse(410, "Gone");
		const mimeType = file.mimeType.toLowerCase();
		const inline = INLINE.has(mimeType);
		const disposition = contentDisposition(mimeType, name).replace(
			/^(inline|attachment)/,
			inline ? "inline" : "attachment",
		);
		const headers: Record<string, string> = {
			"Content-Type": file.mimeType,
			"Content-Disposition": disposition,
			"Content-Length": String(file.size),
			"Cache-Control": "private",
			...blobSecurityHeaders(),
		};
		if (mimeType !== "application/pdf") {
			headers["Content-Security-Policy"] = "sandbox; default-src 'none'";
		}
		return new Response(file.stream, { status: 200, headers });
	} catch (error) {
		// 404 for a reader the attempt refuses too, so a file's existence is not confirmed.
		if (
			error instanceof NotAllowed ||
			error instanceof NotFound ||
			error instanceof InvalidData
		) {
			return notFoundResponse();
		}
		throw error;
	}
};
