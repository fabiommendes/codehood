import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { UserActor } from "@/auth/actor";
import { pruneTeamRepositories } from "@/commands/prune-team-repositories";
import { REPOSITORY_ROOT } from "@/core/constants";
import { bareRepositoryPath } from "@/services/git/bare";
import {
	assignmentScenario,
	cleanupAssignmentScenarios,
	createTeam,
	folderExists,
} from "./assignment-scenario";

/// Ids far above any seeded or created team, picked per run so that spec files
/// sharing a worker do not meet.
const BASE = 5_000_000 + Math.floor(Math.random() * 1_000_000) * 10;

const made: string[] = [];

async function folder(name: string): Promise<string> {
	const dir = path.resolve(REPOSITORY_ROOT, name);
	await mkdir(dir, { recursive: true });
	await writeFile(path.join(dir, "HEAD"), "ref: refs/heads/main\n");
	made.push(dir);
	return dir;
}

test.afterEach(async () => {
	for (const dir of made.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
	await cleanupAssignmentScenarios();
});

test("removes the folder of an id that no team has", async () => {
	const orphan = await folder(`${BASE + 1}.git`);
	const report = await pruneTeamRepositories({});
	expect(existsSync(orphan)).toBe(false);
	expect(report.removed).toContain(`${BASE + 1}.git`);
});

test("keeps the folder of a team", async () => {
	const scenario = await assignmentScenario();
	const team = await createTeam(scenario, scenario.students[0] as UserActor);
	expect(folderExists(team)).toBe(true);
	const report = await pruneTeamRepositories({});
	expect(folderExists(team)).toBe(true);
	expect(report.removed).not.toContain(`${team.id}.git`);
});

test("keeps other names, hooks and loose files", async () => {
	const hooks = await folder("_hooks");
	const other = await folder(`${BASE + 2}.git.bak`);
	const leading = await folder(`0${BASE + 3}x.git`);
	const zero = await folder("0.git");
	const loose = path.resolve(REPOSITORY_ROOT, `${BASE + 4}.git`);
	await writeFile(loose, "not a folder");
	made.push(loose);
	const report = await pruneTeamRepositories({});
	for (const kept of [hooks, other, leading, zero, loose]) {
		expect(existsSync(kept)).toBe(true);
	}
	expect(report.removed).toEqual([]);
});

test("removes a symlink as a link and leaves its target alone", async () => {
	const target = await mkdtemp(path.join(tmpdir(), "prune-target-"));
	made.push(target);
	await writeFile(path.join(target, "keep.txt"), "precious");
	await mkdir(REPOSITORY_ROOT, { recursive: true });
	const link = path.resolve(REPOSITORY_ROOT, `${BASE + 5}.git`);
	await symlink(target, link);
	made.push(link);
	const report = await pruneTeamRepositories({});
	expect(report.removed).toContain(`${BASE + 5}.git`);
	expect(existsSync(link)).toBe(false);
	expect(await readFile(path.join(target, "keep.txt"), "utf8")).toBe(
		"precious",
	);
});

test("a dry run lists what it would remove and deletes nothing", async () => {
	const orphan = await folder(`${BASE + 6}.git`);
	const report = await pruneTeamRepositories({ dryRun: true });
	expect(report.removed).toContain(`${BASE + 6}.git`);
	expect(existsSync(orphan)).toBe(true);
});

test("a missing root is not an error", async () => {
	const report = await pruneTeamRepositories({
		root: path.join(tmpdir(), `prune-missing-${BASE}`),
	});
	expect(report.removed).toEqual([]);
});

test("the path of a team is the one the command matches", () => {
	expect(path.basename(bareRepositoryPath(BASE + 7))).toBe(`${BASE + 7}.git`);
});
