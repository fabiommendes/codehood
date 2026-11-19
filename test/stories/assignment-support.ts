import type { UserActor } from "@/auth/actor";
import type { AssignmentId, CourseId, TeamId } from "@/core/schemas/base";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import {
	type AssignmentUpsertInput,
	daysFromNow,
	hoursFromNow,
} from "../assignment-scenario";
import {
	cleanupGitTest,
	cloneInto,
	commitFiles,
	defaultRules,
	type GitServer,
	git,
	startGitServer,
} from "../git-server";
import { seedUser } from "./helpers";
import { hrefOf } from "./repository-support";

export { tokenOf } from "../assignment-scenario";
export { daysFromNow, hoursFromNow };

/// A course with its instructor and enrolled students, for the stories of assignments.
export type World = {
	courseId: CourseId;
	/// The course URL, e.g. `/disc/teacher_2026-1`.
	href: string;
	instructor: UserActor;
	students: UserActor[];
};

/// An assignment created in a world, with the payload that created it.
export type Work = {
	id: AssignmentId;
	slug: string;
	input: AssignmentUpsertInput;
};

/**
 * A course taught by `<prefix>-teacher` with one enrolled student per name,
 * `<prefix>-s1`, `<prefix>-s2` and so on. The prefix keeps usernames unique
 * between stories.
 */
export async function seedWorld(
	prefix: string,
	studentNames: string[],
): Promise<World> {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-teacher`,
		name: `Teacher ${prefix}`,
	});
	const course = await persistedCourseFactory.create(
		{ instructor: teacher.username },
		{
			transient: {
				students: studentNames.map((name, index) => ({
					username: `${prefix}-s${index + 1}`,
					name,
				})),
			},
		},
	);
	return {
		courseId: course.id,
		href: hrefOf(course),
		instructor: {
			username: teacher.username,
			role: "INSTRUCTOR",
			name: teacher.name,
		},
		students: course.students.map((user) => ({
			username: user.username,
			role: "STUDENT" as const,
			name: user.name,
		})),
	};
}

/// The `n`th student of the world, counting from 1.
export function student(world: World, n: number): UserActor {
	const found = world.students[n - 1];
	if (!found) throw new Error(`the world has no student ${n}`);
	return found;
}

/// Creates an assignment of the world as its instructor. Defaults to an individual one due in a week.
export async function seedAssignment(
	world: World,
	slug: string,
	over: Partial<AssignmentUpsertInput> = {},
): Promise<Work> {
	const input: AssignmentUpsertInput = {
		course: world.courseId,
		slug,
		title: `Assignment ${slug}`,
		body: `# Statement of ${slug}\n\nBuild it.\n`,
		opensAt: null,
		dueAt: daysFromNow(7),
		closesAt: null,
		teamMin: 1,
		teamMax: 1,
		teamsLockAt: null,
		template: null,
		restrictions: null,
		rev: null,
		...over,
	};
	const row = await db.assignment.upsert(input, { actor: world.instructor });
	return { id: row.id, slug, input };
}

/// Upserts the assignment again with `changes`, e.g. to move its dates into the past once the teams exist.
export async function changeWork(
	world: World,
	work: Work,
	changes: Partial<AssignmentUpsertInput>,
): Promise<Work> {
	const input = { ...work.input, ...changes };
	await db.assignment.upsert(input, { actor: world.instructor });
	return { ...work, input };
}

/// `student` creates a team (or their repository, on an individual assignment) as the student does.
export function createTeamAs(work: Work, student: UserActor, name: string) {
	return db.team.create({ id: work.id }, { name }, { actor: student });
}

/// The instructor creates a team with `members` already in it.
export function createStaffTeam(
	world: World,
	work: Work,
	name: string,
	members: UserActor[],
) {
	return db.team.createFor(
		{ id: work.id },
		{ name, members: members.map((member) => member.username) },
		{ actor: world.instructor },
	);
}

/// Gives a team a deadline of its own, as the instructor does with the CLI.
export function extendTeam(
	world: World,
	team: { id: number },
	dueAt: Date,
): Promise<unknown> {
	return db.team.setDueAt({ id: team.id as TeamId }, dueAt, {
		actor: world.instructor,
	});
}

let gitServer: Promise<GitServer> | null = null;

/**
 * Pushes `files` to the `main` of the team's repository with the real `git`
 * binary and records the push as `by` at `at` (now when omitted). Returns the
 * commit sha.
 *
 * Pushes with a past `at` stand for work done before the story began: the
 * time of a push is the server's, so the story cannot make it wait.
 */
export async function deliver(
	team: { id: number },
	files: Record<string, string>,
	message: string,
	options: { by: UserActor; at?: Date },
): Promise<string> {
	gitServer ??= startGitServer(() => defaultRules());
	const server = await gitServer;
	const dir = await cloneInto(server.url(team.id, "story"));
	const sha = await commitFiles(dir, files, message);
	await git(dir, ["push", "--quiet", "origin", "HEAD:main"]);
	const last = await prisma.teamPush.findFirst({
		where: { teamId: team.id },
		orderBy: { id: "desc" },
	});
	await prisma.teamPush.create({
		data: {
			teamId: team.id,
			username: options.by.username,
			oldSha: last?.newSha ?? null,
			newSha: sha,
			createdAt: options.at ?? new Date(),
		},
	});
	return sha;
}

/// Stops the git server of `deliver` and removes its working copies.
export async function stopDelivering(): Promise<void> {
	const server = await gitServer;
	gitServer = null;
	await server?.close();
	cleanupGitTest();
}

/// The seven characters of a commit the pages show.
export function shortSha(sha: string): string {
	return sha.slice(0, 7);
}
