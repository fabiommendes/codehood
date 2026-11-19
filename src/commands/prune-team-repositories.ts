import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Command } from "commander";
import { REPOSITORY_ROOT } from "@/core/constants";
import { prisma } from "@/db/client";

/// A folder named by a team id: `<positive integer>.git`, no leading zero.
const TEAM_FOLDER = /^([1-9][0-9]*)\.git$/;

export type PruneReport = {
	/// Names of the entries removed, or that would be on a dry run.
	removed: string[];
};

/**
 * Removes the repository folders under `root` whose id belongs to no team.
 *
 * The folders are listed before the database is read: a team row is written
 * before its folder, so a folder listed without a row is an orphan.
 */
export async function pruneTeamRepositories(options: {
	dryRun?: boolean;
	root?: string;
}): Promise<PruneReport> {
	const root = options.root ?? REPOSITORY_ROOT;
	let entries: import("node:fs").Dirent[];
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { removed: [] };
		}
		throw error;
	}
	// A symlink to a folder is listed as a link, never as a directory.
	const candidates = entries
		.filter((e) => e.isDirectory() || e.isSymbolicLink())
		.map((e) => ({ name: e.name, id: TEAM_FOLDER.exec(e.name)?.[1] }))
		.filter((e): e is { name: string; id: string } => e.id !== undefined)
		.filter((e) => Number.isSafeInteger(Number(e.id)));
	if (candidates.length === 0) return { removed: [] };

	const known = await prisma.team.findMany({
		where: { id: { in: candidates.map((c) => Number(c.id)) } },
		select: { id: true },
	});
	const owned = new Set(known.map((t) => t.id));
	const removed: string[] = [];
	for (const { name, id } of candidates) {
		if (owned.has(Number(id))) continue;
		if (!options.dryRun) {
			// `rm` unlinks a symlink instead of following it.
			await rm(path.join(root, name), { recursive: true, force: true });
		}
		removed.push(name);
	}
	return { removed };
}

export const pruneTeamRepositoriesCommand = new Command(
	"prune-team-repositories",
)
	.description("Remove repository folders of teams that no longer exist")
	.option("--dry-run", "list what would be removed and delete nothing")
	.action(async (options: { dryRun?: boolean }) => {
		const { removed } = await pruneTeamRepositories(options);
		const verb = options.dryRun ? "Would remove" : "Removed";
		for (const name of removed) console.log(`${verb} ${name}`);
		console.log(`${verb} ${removed.length} folder(s).`);
	});
