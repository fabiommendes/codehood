import type { APIRoute } from "astro";
import { db } from "@/db";
import {
	attachmentResponse,
	lastPathSegment,
	notFoundResponse,
} from "@/utils/blob-response";

export const prerender = false;

/// Serves an attachment of a question to whoever reads it whole, at `?version=` or the latest; anyone else gets 404.
export const GET: APIRoute = ({ params, locals, request, url }) => {
	const { actor } = locals;
	const name = lastPathSegment(request);
	const { publicId } = params;
	if (!actor || !publicId || !name) return notFoundResponse();
	const version = url.searchParams.get("version") || undefined;
	return attachmentResponse(() =>
		db.question.attachment({ publicId, version }, name, { actor }),
	);
};
