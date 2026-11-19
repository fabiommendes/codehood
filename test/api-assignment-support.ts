import type { UserActor } from "@/auth/actor";
import { type AssignmentFixture, apiKeyFor } from "./assignment-e2e";
import { assignmentPk, daysFromNow } from "./assignment-scenario";
import { TEST_BASE_URL } from "./env";
import {
	type APIRequestContext,
	expect,
	type PlaywrightWorkerArgs,
} from "./fixtures";

/// Support for the specs of the assignment and team REST routes.

const contexts: APIRequestContext[] = [];

/**
 * A request context that sends `user`'s own API key as a bearer token, or no
 * credentials at all for `null`. Isolated, so no cookie ever outranks the key.
 */
export async function apiAs(
	playwright: PlaywrightWorkerArgs["playwright"],
	user: UserActor | null,
): Promise<APIRequestContext> {
	const extraHTTPHeaders = user
		? { Authorization: `Bearer ${await apiKeyFor(user)}` }
		: undefined;
	const context = await playwright.request.newContext({
		baseURL: TEST_BASE_URL,
		extraHTTPHeaders,
	});
	contexts.push(context);
	return context;
}

/// Disposes every context `apiAs` made.
export async function disposeApiContexts(): Promise<void> {
	await Promise.all(contexts.splice(0).map((context) => context.dispose()));
}

/// The collection URL of the assignments of the fixture's course.
export function assignmentsUrl(
	fixture: Pick<AssignmentFixture, "courseSegment">,
) {
	return `/api/course/${fixture.courseSegment}/assignment`;
}

/// The URL of one assignment of the fixture's course; its own slug by default.
export function assignmentUrl(
	fixture: Pick<AssignmentFixture, "courseSegment" | "slug">,
	slug: string = fixture.slug,
) {
	return `${assignmentsUrl(fixture)}/${slug}`;
}

/// The URL of the teams of the fixture's assignment, or of one team by `publicId`.
export function teamsUrl(
	fixture: Pick<AssignmentFixture, "courseSegment" | "slug">,
	publicId?: string | number,
) {
	const base = `${assignmentUrl(fixture)}/team`;
	return publicId === undefined ? base : `${base}/${publicId}`;
}

/// The URL of one member of a team.
export function memberUrl(
	fixture: Pick<AssignmentFixture, "courseSegment" | "slug">,
	publicId: string,
	username: string,
) {
	return `${teamsUrl(fixture, publicId)}/member/${username}`;
}

/// A valid PUT body for an assignment (no slug: the path names it).
export function assignmentBody(
	overrides: Record<string, unknown> = {},
): Record<string, unknown> {
	return {
		title: "Project",
		body: "# Project\n\nBuild it.\n",
		dueAt: daysFromNow(7).toISOString(),
		teamMin: 1,
		teamMax: 3,
		...overrides,
	};
}

/// The `If-Match` / ETag text of a row version, as a body's `updatedAt` spells it.
export function etagFor(updatedAt: string): string {
	return `"${updatedAt}"`;
}

/// The key a REST route must never put in a body or a schema.
const SECRET_KEYS = [
	"token",
	"tempToken",
	"tempTokenExpiresAt",
	"cloneUrl",
	"tempCloneUrl",
	"joinCode",
	"baseSha",
];

/**
 * Fails when any object nested in `value` has a key that carries a secret: a
 * token, a clone URL, `joinCode` or `baseSha`.
 */
export function assertNoSecrets(value: unknown, where = "$"): void {
	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			assertNoSecrets(item, `${where}[${index}]`);
		});
		return;
	}
	if (value === null || typeof value !== "object") return;
	for (const [key, child] of Object.entries(value)) {
		expect(SECRET_KEYS, `${where}.${key}`).not.toContain(key);
		assertNoSecrets(child, `${where}.${key}`);
	}
}

/// The key of the assignment in service calls, re-exported for the specs.
export { assignmentPk };

/// The students of a fixture, typed as five: a spec reads only as many as it asked the fixture for.
export type Roster = [UserActor, UserActor, UserActor, UserActor, UserActor];

/// The students of `fixture` as a {@link Roster}.
export function rosterOf(fixture: Pick<AssignmentFixture, "students">): Roster {
	return fixture.students as Roster;
}
