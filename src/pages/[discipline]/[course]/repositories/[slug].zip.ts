import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { APIRoute } from "astro";
import { NotAllowed } from "@/core/error";
import { db } from "@/db";
import { parseCourseSegment } from "@/urls";

export const prerender = false;

/// Streams the zip of a repository's head to a signed-in reader of the course.
export const GET: APIRoute = async ({ locals, params, redirect }) => {
	const actor = locals.actor;
	if (!actor) return redirect("/login");

	const parsed = params.course ? parseCourseSegment(params.course) : null;
	if (!parsed || !params.discipline || !params.slug) {
		return new Response("Not found", { status: 404 });
	}
	const course = {
		discipline: params.discipline,
		instructor: parsed.instructor,
		edition: parsed.edition,
	};

	let hash: string | null;
	try {
		hash = await db.repository.zip({ course, slug: params.slug }, { actor });
	} catch (error) {
		if (error instanceof NotAllowed) {
			return new Response("Forbidden", { status: 403 });
		}
		throw error;
	}
	if (!hash) return new Response("Not found", { status: 404 });

	const file = db.blob.blobPath(hash);
	return new Response(
		Readable.toWeb(createReadStream(file)) as ReadableStream,
		{
			status: 200,
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename="${params.slug}.zip"`,
				"Cache-Control": "private, no-store",
			},
		},
	);
};
