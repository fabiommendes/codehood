import http from "node:http";
import type { UserActor } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	assignmentScenario,
	createTeam,
	type Scenario,
	type ScenarioOptions,
	type TeamMine,
} from "./assignment-scenario";
import { TEST_BASE_URL } from "./env";
import { git } from "./git-server";

/// Support for the e2e specs that clone from, and push to, the git routes of
/// the test server with the real `git` binary.

export type AssignmentFixture = Scenario & {
	/// The assignment's slug, as the git routes and the REST API name it.
	slug: string;
	/// `<discipline>/<instructor>_<edition>` of the course.
	courseSegment: string;
};

/** A course with an assignment, its students and an instructor, ready for the git routes. */
export async function assignmentFixture(
	options: ScenarioOptions = {},
): Promise<AssignmentFixture> {
	const scenario = await assignmentScenario(options);
	const course = await prisma.course.findUniqueOrThrow({
		where: { id: scenario.courseId },
		select: { disciplineSlug: true, instructorId: true, editionSlug: true },
	});
	return {
		...scenario,
		slug: scenario.assignment.slug,
		courseSegment: `${course.disciplineSlug}/${course.instructorId}_${course.editionSlug}`,
	};
}

/// Changes columns of the assignment straight in the database, bypassing the
/// service's rules on dates (a closing date in the past, say).
export function setAssignmentColumns(
	fixture: Pick<AssignmentFixture, "assignment">,
	data: { opensAt?: Date | null; closesAt?: Date | null; dueAt?: Date },
): Promise<unknown> {
	return prisma.assignment.update({
		where: { id: fixture.assignment.id },
		data,
	});
}

/** A new team made by `student`, with its repository folder. */
export function teamOf(
	fixture: AssignmentFixture,
	student: UserActor,
): Promise<TeamMine> {
	return createTeam(fixture, student);
}

/** The clone URL of a member: `git` appends `/info/refs` and friends. */
export function teamGitUrl(token: string, slug: string): string {
	return `${TEST_BASE_URL}/git/${token}/${slug}.git`;
}

/** The clone URL the instructor uses for the team `publicId`, with an API key. */
export function instructorGitUrl(
	fixture: Pick<AssignmentFixture, "courseSegment" | "slug">,
	publicId: string,
): string {
	return `${TEST_BASE_URL}/api/course/${fixture.courseSegment}/assignment/${fixture.slug}/team/${publicId}/git`;
}

/** A new CLI API key of `user`, as the raw bearer token. */
export async function apiKeyFor(user: UserActor): Promise<string> {
	const key = await db.apiKey.create(
		{
			name: "git-test",
			kind: "CLI",
			createdBy: { username: user.username, name: user.name },
		},
		{ actor: user },
	);
	return key.token as string;
}

/// The git arguments that send `key` as a bearer token on every request.
export function bearerArgs(key: string): string[] {
	return ["-c", `http.extraHeader=Authorization: Bearer ${key}`];
}

/** Runs `git` in `cwd` sending `key` as a bearer token, with the isolated environment of {@link git}. */
export function gitWithKey(
	key: string,
	cwd: string,
	args: string[],
	options: { allowFail?: boolean } = {},
) {
	return git(cwd, [...bearerArgs(key), ...args], options);
}

/**
 * Starts an upload-pack POST whose body never ends and resolves once it is sent.
 *
 * The server keeps its operation slot for that token until `release()`.
 */
export async function holdUploadPack(
	url: string,
): Promise<{ release(): void }> {
	const target = new URL(`${url}/git-upload-pack`);
	const request = http.request({
		method: "POST",
		hostname: target.hostname,
		port: target.port,
		path: target.pathname,
		headers: {
			"Content-Type": "application/x-git-upload-pack-request",
			"Transfer-Encoding": "chunked",
		},
	});
	request.on("error", () => {});
	request.on("response", (response) => response.resume());
	await new Promise<void>((resolve) => {
		request.write("0008want", () => resolve());
	});
	return { release: () => request.destroy() };
}
