import type { APIRoute } from "astro";
import { NotFound } from "@/core/error";
import { db } from "@/db";
import { blobSecurityHeaders, contentDisposition } from "@/utils/blob-response";

export const prerender = false;

/// Serves an attachment of a report to whoever may read the report; anyone else gets 404.
export const GET: APIRoute = async ({ params, locals }) => {
	const { actor } = locals;
	if (!actor || !params.publicId || !params.filename) return notFound();
	try {
		const file = await db.report.attachment(
			{ publicId: params.publicId },
			params.filename,
			{ actor },
		);
		return new Response(new Uint8Array(file.bytes), {
			status: 200,
			headers: {
				"Content-Type": file.mimeType,
				"Content-Disposition": contentDisposition(file.mimeType, file.filename),
				...blobSecurityHeaders(),
			},
		});
	} catch (error) {
		if (error instanceof NotFound) return notFound();
		throw error;
	}
};

function notFound(): Response {
	return new Response("Not found", {
		status: 404,
		headers: { "Content-Type": "text/plain", ...blobSecurityHeaders() },
	});
}
