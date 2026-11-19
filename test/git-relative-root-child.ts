import { createBareRepository } from "@/services/git/bare";
import {
	cleanupGitTest,
	cloneInto,
	commitFiles,
	defaultRules,
	freshTeamId,
	git,
	startGitServer,
} from "./git-server";

/// Run by `git-relative-root.spec.ts` in a process of its own, whose
/// `REPOSITORY_ROOT` is a relative path: pushes to a refused ref and then to
/// `main`, and prints both results as one line of JSON.

const server = await startGitServer(() => defaultRules());
try {
	const id = freshTeamId();
	await createBareRepository(id);
	const dir = await cloneInto(server.url(id, "key"));
	await commitFiles(dir, { "a.txt": "a\n" });
	const push = (ref: string) =>
		git(dir, ["push", "origin", ref], { allowFail: true });
	const feature = await push("HEAD:refs/heads/feature");
	const main = await push("HEAD:refs/heads/main");
	console.log(JSON.stringify({ feature, main }));
} finally {
	cleanupGitTest();
	await server.close();
}
