import type { APIRoute } from "astro";
import { db } from "@/db";
import { parseCourseParams } from "@/urls";
import {
	attachmentResponse,
	lastPathSegment,
	notFoundResponse,
} from "@/utils/blob-response";

export const prerender = false;

/// Serves an attachment of an exam to whoever may download it now; anyone else gets 404.
export const GET: APIRoute = ({ params, locals, request }) => {
	const { actor } = locals;
	const name = lastPathSegment(request);
	const { slug } = params;
	if (!actor || !slug || !name) return notFoundResponse();
	return attachmentResponse(() =>
		db.exam.attachment(
			{ course: parseCourseParams(params as Record<string, string>), slug },
			name,
			{
				actor,
			},
		),
	);
};
