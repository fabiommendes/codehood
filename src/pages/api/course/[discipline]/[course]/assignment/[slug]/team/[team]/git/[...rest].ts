import { stat } from "node:fs/promises";
import type { APIRoute } from "astro";
import { serveTeamGit } from "@/api/team-git";
import { InvalidData } from "@/core/error";
import { db } from "@/db";
import { bareRepositoryPath } from "@/services/git/bare";
import { notFound, parseGitRequest } from "@/services/git/http";
import { parseCourseParams } from "@/urls";

export const prerender = false;

/// Answers 401, with no challenge: a git client that gets one asks for a password.
function unauthorized(): Response {
	return new Response("Unauthorized\n", {
		status: 401,
		headers: { "Content-Type": "text/plain; charset=utf-8" },
	});
}

/// Whether the folder of a team repository exists.
async function onDisk(teamId: number): Promise<boolean> {
	try {
		return (await stat(bareRepositoryPath(teamId))).isDirectory();
	} catch {
		return false;
	}
}

/// Serves the read-only smart protocol of a team to an instructor with an API key.
const serve: APIRoute = async ({ params, request, locals }) => {
	const { actor, apiKey } = locals;
	if (!actor || !apiKey) return unauthorized();
	const { slug, team: publicId, rest } = params;
	if (!slug || !publicId) return notFound();
	const git = parseGitRequest(
		request.method,
		rest ?? "",
		new URL(request.url).searchParams,
	);
	if (git?.service !== "git-upload-pack") return notFound();

	let course: ReturnType<typeof parseCourseParams>;
	try {
		course = parseCourseParams(params as Record<string, string>);
	} catch (error) {
		if (error instanceof InvalidData) return notFound();
		throw error;
	}
	const team = await db.team.findForManager(
		{ course, slug, publicId },
		{ actor },
	);
	if (!team || !(await onDisk(team.id))) return notFound();
	return serveTeamGit({
		teamId: team.id,
		key: `api-key-${apiKey.id}`,
		request,
		git,
	});
};

export const GET = serve;
export const POST = serve;
