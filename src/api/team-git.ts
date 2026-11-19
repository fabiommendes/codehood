import { SYSTEM } from "@/auth/actor";
import type { TeamId } from "@/core/schemas/base";
import { db } from "@/db";
import { readMain } from "@/services/git/bare";
import { ensureGit } from "@/services/git/boot";
import type { PushRules } from "@/services/git/hook";
import { type GitRequest, notFound, serveGit } from "@/services/git/http";

/// What a push to the repository of a team is held to, and who makes it.
export type TeamWriter = { username: string; rules: PushRules };

/** What serving one git request to a team repository needs. */
export type TeamGitInput = {
	teamId: TeamId;
	key: string;
	request: Request;
	git: GitRequest;
	/// Absent for a read-only door.
	writer?: TeamWriter;
};

/// Records the push that moved `main` from `before`, if any; a failure is left to `reconcile`.
async function recordPush(
	teamId: TeamId,
	before: string | null,
	username: string,
): Promise<void> {
	try {
		const after = await readMain(teamId);
		if (!after || after === before) return;
		await db.team.recordPush(
			{ id: teamId },
			{ username, oldSha: before, newSha: after },
			{ actor: SYSTEM },
		);
	} catch (error) {
		console.error("could not record a push:", error);
	}
}

/**
 * Serves a git request to the repository of a team after reconciling its push log with the disk.
 *
 * A push is recorded before the response ends, so a client that has seen its
 * `git push` finish finds the record.
 */
export async function serveTeamGit(input: TeamGitInput): Promise<Response> {
	const { teamId, writer } = input;
	await ensureGit();
	try {
		await db.team.reconcile({ id: teamId }, { actor: SYSTEM });
	} catch (error) {
		console.error("could not reconcile a team:", error);
	}
	if (input.git.service === "git-receive-pack" && !writer) return notFound();
	const pushing = writer && input.git.service === "git-receive-pack";
	const before = pushing ? await readMain(teamId) : null;
	return serveGit({
		teamId,
		key: input.key,
		request: input.request,
		git: input.git,
		rules: writer?.rules,
		afterPush: pushing
			? () => recordPush(teamId, before, writer.username)
			: undefined,
	});
}
