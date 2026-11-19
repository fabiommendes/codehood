/**
 * The git protocols behind a token in the URL: the read-only "dumb HTTP" one
 * of a course repository, and the smart one of a team repository, which also
 * takes pushes. The token is the credential, so nothing here reads a session,
 * and every failure answers 404, never 403, so a stranger learns nothing
 * about which tokens ever existed.
 */

import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { APIRoute } from "astro";
import { serveTeamGit } from "@/api/team-git";
import {
	ASSIGNMENT_MAX_FILE_BYTES,
	ASSIGNMENT_MAX_REPO_BYTES,
} from "@/core/constants";
import { db } from "@/db";
import { pushRules } from "@/services/assignment-delivery";
import { bareRepositoryPath } from "@/services/git/bare";
import { parseGitRequest, pushMessages } from "@/services/git/http";
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

/// Splits `<slug>.git/<path>` into its parts, or null.
function splitRest(rest: string): { slug: string; path: string } | null {
	const split = rest.indexOf(".git/");
	if (split < 1) return null;
	return {
		slug: rest.slice(0, split),
		path: rest.slice(split + ".git/".length),
	};
}

/// Whether the folder of a team repository exists.
async function onDisk(teamId: number): Promise<boolean> {
	try {
		return (await stat(bareRepositoryPath(teamId))).isDirectory();
	} catch {
		return false;
	}
}

/// Serves the smart protocol to the team the token belongs to, or answers 404.
async function serveTeam(
	token: string,
	rest: string,
	request: Request,
): Promise<Response> {
	const parts = splitRest(rest);
	if (!parts) return notFound();
	const git = parseGitRequest(
		request.method,
		parts.path,
		new URL(request.url).searchParams,
	);
	if (!git) return notFound();
	const access = await db.team.findByToken(token, parts.slug);
	if (!access?.enrolled) return notFound();
	const now = new Date();
	const { opensAt } = access.assignment;
	if (opensAt && opensAt > now) return notFound();
	if (!(await onDisk(access.team.id))) return notFound();
	return serveTeamGit({
		teamId: access.team.id,
		key: token,
		request,
		git,
		writer: {
			username: access.member.username,
			rules: {
				...pushRules({
					assignment: access.assignment,
					enrolled: access.enrolled,
					now,
					limits: {
						maxRepoBytes: ASSIGNMENT_MAX_REPO_BYTES,
						maxFileBytes: ASSIGNMENT_MAX_FILE_BYTES,
					},
				}),
				messages: pushMessages(),
			},
		},
	});
}

export const POST: APIRoute = ({ params, request }) =>
	params.token
		? serveTeam(params.token, params.rest ?? "", request)
		: notFound();

export const GET: APIRoute = async ({ params, request }) => {
	const rest = params.rest ?? "";
	const parts = splitRest(rest);
	if (!parts || !params.token) return notFound();
	const { slug, path } = parts;

	const repository = await db.repository.findByToken(params.token, slug);
	if (!repository) return serveTeam(params.token, rest, request);
	if (!repository.head) return notFound();
	if (
		path === "info/refs" &&
		new URL(request.url).searchParams.get("service") === "git-receive-pack"
	) {
		return notFound();
	}

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
