import { existsSync, readdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { UserActor } from "@/auth/actor";
import { db, type Repository, type User } from "@/db";
import { prisma } from "@/db/client";
import { persistedAssignmentFactory } from "@/fixtures/assignment.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import {
	repositoryTree,
	type TreeFileSpec,
} from "@/fixtures/repository.factory";
import { persistedTeamFactory } from "@/fixtures/team.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { bareRepositoryPath } from "@/services/git/bare";
import {
	cleanupGitTest,
	cloneInto,
	commitFiles,
	defaultRules,
	type GitServer,
	git,
	startGitServer,
} from "./git-server";

/// Courses, actors and assignments for the specs of assignments and teams,
/// plus the helpers that put pushes in a team: straight into the database, or
/// through the real `git` binary.

export type AssignmentUpsertInput = Parameters<typeof db.assignment.upsert>[0];
export type AssignmentRow = Awaited<ReturnType<typeof db.assignment.upsert>>;
export type TeamMine = Awaited<ReturnType<typeof db.team.create>>;
export type TeamAdmin = Awaited<ReturnType<typeof db.team.createFor>>;

/// A random suffix, not a counter: sibling spec files share one test database.
export function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

const HOUR_MS = 60 * 60 * 1000;

/// An instant `hours` from now; negative for the past.
export function hoursFromNow(hours: number): Date {
	return new Date(Date.now() + hours * HOUR_MS);
}

/// An instant `days` from now; negative for the past.
export function daysFromNow(days: number): Date {
	return hoursFromNow(days * 24);
}

export function actorOf(user: Pick<User, "username" | "role" | "name">) {
	return {
		username: user.username,
		role: user.role,
		name: user.name,
	} satisfies UserActor;
}

export type ScenarioOptions = {
	teamMin?: number;
	teamMax?: number;
	/// The files of the template repository's commit, or `"empty"` for a template with no commit.
	template?: Record<string, TreeFileSpec> | "empty";
	/// Defaults to null: visible at once.
	opensAt?: Date | null;
	/// Defaults to a week from now.
	dueAt?: Date;
	/// Defaults to null: pushes are never refused.
	closesAt?: Date | null;
	/// Defaults to null: teams are open until `dueAt`.
	teamsLockAt?: Date | null;
	restrictions?: AssignmentUpsertInput["restrictions"];
	/// Active students. Defaults to 3.
	students?: number;
	/// Students whose enrollment is DROPPED. Defaults to 0.
	dropped?: number;
};

export type Scenario = {
	courseId: AssignmentRow["courseId"];
	instructor: UserActor;
	students: UserActor[];
	dropped: UserActor[];
	/// A student enrolled in no course of the scenario.
	outsider: UserActor;
	assignment: AssignmentRow;
	/// The payload that created `assignment`, to spread into the next upsert.
	input: AssignmentUpsertInput;
	template: { slug: string; repository: Repository } | null;
};

/// Assignments created by this file, for `cleanupAssignmentScenarios`.
const created = new Set<number>();

/// Commits `files` as the next head of `repository`, as `instructor`.
export async function commitToRepository(
	repository: Pick<Repository, "id">,
	files: Record<string, TreeFileSpec>,
	instructor: UserActor,
): Promise<Repository> {
	const { files: blobs, tree } = repositoryTree(files);
	const pk = { id: repository.id };
	await db.repository.addFiles(pk, blobs, { actor: instructor });
	return db.repository.commit(pk, { tree }, { actor: instructor });
}

/// A new repository in the course of the scenario, with one commit of `files` when given.
export async function addRepository(
	scenario: Scenario,
	files?: Record<string, TreeFileSpec>,
): Promise<Repository> {
	const repository = await db.repository.create(
		{ course: scenario.courseId, slug: tag("repo") },
		{ actor: scenario.instructor },
	);
	return files
		? commitToRepository(repository, files, scenario.instructor)
		: repository;
}

/**
 * A new course with an instructor, active and dropped students, an outsider and
 * one assignment, optionally with a template repository.
 */
export async function assignmentScenario(
	options: ScenarioOptions = {},
): Promise<Scenario> {
	const instructorUser = await persistedUserFactory.create({
		role: "INSTRUCTOR",
	});
	const instructor = actorOf(instructorUser);
	const active = options.students ?? 3;
	const droppedCount = options.dropped ?? 0;
	const course = await persistedCourseFactory.create(
		{ instructor: instructor.username },
		{ transient: { students: active + droppedCount } },
	);
	const students = course.students.slice(0, active).map(actorOf);
	const dropped = course.students.slice(active).map(actorOf);
	for (const student of dropped) {
		await db.enrollment.delete(
			{ course: course.id, username: student.username },
			{ actor: instructor },
		);
	}
	const outsider = actorOf(
		await persistedUserFactory.create({ role: "STUDENT" }),
	);

	let template: Scenario["template"] = null;
	if (options.template) {
		let repository = await db.repository.create(
			{ course: course.id, slug: tag("tpl") },
			{ actor: instructor },
		);
		if (options.template !== "empty") {
			repository = await commitToRepository(
				repository,
				options.template,
				instructor,
			);
		}
		template = { slug: repository.slug, repository };
	}

	const input: AssignmentUpsertInput = {
		course: course.id,
		slug: tag("work"),
		title: "Project",
		body: "# Project\n\nBuild it.\n",
		opensAt: options.opensAt ?? null,
		dueAt: options.dueAt ?? daysFromNow(7),
		closesAt: options.closesAt ?? null,
		teamMin: options.teamMin ?? 1,
		teamMax: options.teamMax ?? 3,
		teamsLockAt: options.teamsLockAt ?? null,
		template: template?.slug ?? null,
		restrictions: options.restrictions ?? null,
		rev: null,
	};
	const assignment = await persistedAssignmentFactory.create(input, {
		transient: { actor: instructor },
	});
	created.add(assignment.id);

	return {
		courseId: course.id,
		instructor,
		students,
		dropped,
		outsider,
		assignment,
		input,
		template,
	};
}

/// The key that names an assignment to the services.
export function assignmentPk(scenario: Pick<Scenario, "assignment">) {
	return { id: scenario.assignment.id };
}

/// The key that names a team to the services.
export function teamPk(team: { id: TeamMine["id"] }) {
	return { id: team.id };
}

/// Upserts the scenario's assignment again, as its instructor, with `changes` applied.
export function changeAssignment(
	scenario: Scenario,
	changes: Partial<AssignmentUpsertInput>,
): Promise<AssignmentRow> {
	return db.assignment.upsert(
		{ ...scenario.input, ...changes },
		{ actor: scenario.instructor },
	);
}

/// `student` creates a team of their own, named `name` or at random.
export function createTeam(
	scenario: Scenario,
	student: UserActor,
	name: string = tag("team"),
): Promise<TeamMine> {
	return persistedTeamFactory.create(
		{ name },
		{ transient: { assignment: assignmentPk(scenario), actor: student } },
	);
}

/// Marks the enrollment of `student` DROPPED.
export function dropStudent(scenario: Scenario, student: UserActor) {
	return db.enrollment.delete(
		{ course: scenario.courseId, username: student.username },
		{ actor: scenario.instructor },
	);
}

/// Reactivates the enrollment of `student`.
export function reenroll(scenario: Scenario, student: UserActor) {
	return db.enrollment.create(
		{ course: scenario.courseId, username: student.username },
		{ actor: scenario.instructor },
	);
}

/// The stored token of a member, straight from the database.
export async function tokenOf(
	team: { id: number },
	username: string,
): Promise<string | null> {
	const row = await prisma.teamMember.findUnique({
		where: { teamId_username: { teamId: team.id, username } },
		select: { token: true },
	});
	return row?.token ?? null;
}

/// The stored temporary token of a member, expired or not, straight from the database.
export async function tempTokenOf(
	team: { id: number },
	username: string,
): Promise<string | null> {
	const row = await prisma.teamMember.findUnique({
		where: { teamId_username: { teamId: team.id, username } },
		select: { tempToken: true },
	});
	return row?.tempToken ?? null;
}

/// Moves the expiry of a member's temporary token to a minute ago.
export async function expireTempToken(
	team: { id: number },
	username: string,
): Promise<void> {
	await prisma.teamMember.update({
		where: { teamId_username: { teamId: team.id, username } },
		data: { tempTokenExpiresAt: new Date(Date.now() - 60_000) },
	});
}

export type PushSeed = { sha: string; createdAt: Date; username?: string };

/// Writes `TeamPush` rows straight into the database, in the order given, each
/// one starting from the sha of the one before.
export async function seedPushes(
	team: { id: number },
	pushes: PushSeed[],
): Promise<void> {
	let previous: string | null = null;
	for (const push of pushes) {
		await prisma.teamPush.create({
			data: {
				teamId: team.id,
				username: push.username ?? null,
				oldSha: previous,
				newSha: push.sha,
				createdAt: push.createdAt,
			},
		});
		previous = push.sha;
	}
}

/// A 40-digit hex sha made of `digit`, for pushes nobody reads.
export function fakeSha(digit: string): string {
	return digit.repeat(40);
}

//
// The real git binary
//

let gitServer: Promise<GitServer> | null = null;

/**
 * Clones the repository of `team`, commits `files` and pushes them to `main`,
 * with the real `git` binary and no rules in the way. Returns the new commit.
 *
 * The push does not go through `TeamService`, so no `TeamPush` is recorded.
 */
export async function realPush(
	team: { id: number },
	files: Record<string, string | Buffer>,
): Promise<string> {
	gitServer ??= startGitServer(() => defaultRules());
	const server = await gitServer;
	const dir = await cloneInto(server.url(team.id, "test"));
	const sha = await commitFiles(dir, files);
	await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);
	return sha;
}

/// Stops the server of `realPush` and removes its working copies.
export async function stopRealPush(): Promise<void> {
	const server = await gitServer;
	gitServer = null;
	await server?.close();
	cleanupGitTest();
}

//
// The disk
//

/// The names of the repository folders on disk.
export function repositoryFolders(): string[] {
	const root = path.dirname(bareRepositoryPath(1));
	return existsSync(root)
		? readdirSync(root).filter((name) => name.endsWith(".git"))
		: [];
}

/// Whether the folder of `team` exists.
export function folderExists(team: { id: number }): boolean {
	return existsSync(bareRepositoryPath(team.id));
}

/// Removes the folders of every team of the scenarios this file created.
export async function cleanupAssignmentScenarios(): Promise<void> {
	const teams = await prisma.team.findMany({
		where: { assignmentId: { in: [...created] } },
		select: { id: true },
	});
	for (const { id } of teams) {
		await rm(bareRepositoryPath(id), { recursive: true, force: true });
	}
	created.clear();
}
