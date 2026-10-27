/**
 * The read-only "dumb HTTP" git protocol of a course repository. The token in
 * the URL is the credential, so nothing here reads a session, and every
 * failure answers 404, never 403, so a stranger learns nothing about which
 * tokens ever existed.
 */

import { Readable } from "node:stream";
import type { APIRoute } from "astro";
import { db } from "@/db";
import { looseObject } from "@/services/git/objects";

export const prerender = false;

const REF = "refs/heads/main";

/// Matches `objects/<xx>/<38 hex>`.
const OBJECT_PATH = /^objects\/([0-9a-f]{2})\/([0-9a-f]{38})$/;

function notFound(): Response {
	return new Response("Not found\n", {
		status: 404,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

function text(body: string, extra: Record<string, string> = {}): Response {
	return new Response(body, {
		status: 200,
		headers: { "Content-Type": "text/plain; charset=utf-8", ...extra },
	});
}

export const GET: APIRoute = async ({ params }) => {
	const rest = params.rest ?? "";
	const split = rest.indexOf(".git/");
	if (split < 1 || !params.token) return notFound();
	const slug = rest.slice(0, split);
	const path = rest.slice(split + ".git/".length);

	const repository = await db.repository.findByToken(params.token, slug);
	if (!repository?.head) return notFound();

	if (path === "info/refs") {
		return text(`${repository.head}\t${REF}\n`, {
			"Cache-Control": "no-cache",
		});
	}
	if (path === "HEAD") {
		return text(`ref: ${REF}\n`, { "Cache-Control": "no-cache" });
	}
	if (path === "objects/info/packs") {
		return text("", { "Cache-Control": "no-cache" });
	}

	const match = OBJECT_PATH.exec(path);
	if (!match) return notFound();
	const object = await db.repository.readObject(
		repository,
		`${match[1]}${match[2]}`,
	);
	if (!object) return notFound();
	return new Response(
		Readable.toWeb(looseObject(object)) as unknown as ReadableStream,
		{
			status: 200,
			headers: {
				"Content-Type": "application/x-git-loose-object",
				"Cache-Control": "public, max-age=31536000, immutable",
			},
		},
	);
};
