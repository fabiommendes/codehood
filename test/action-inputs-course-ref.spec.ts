import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { userFactory } from "@/fixtures/user.factory";

/**
 * `dev/specs/to-do/actions-no-raw-ids.md`'s "Changes" section: every
 * course-scoped action takes the course as `discipline` + `course`
 * (`<instructor>_<edition>`, the same grammar as the URL segment, parsed by
 * `parseCourseParams`/`parseCourseSegment`) instead of a numeric `courseId`,
 * and `auth.revokeApiKey`/`admin.revokeInvite` take `publicId` instead of a
 * numeric `id`. Each case below calls its action with the new input the way
 * a browser does (`POST /_actions/<name>`) and checks the effect through the
 * matching service — the UI flow itself is already covered by the story
 * tests in `test/stories/`.
 */

const PASSWORD = "correct-horse-battery-staple";

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

/// `persistedEditionFactory`'s own default cycles through only 20 slugs by
/// sequence, which collides across the several courses this file creates (and
/// with the seeded demo editions) — see `api-public-refs.spec.ts`'s
/// `uniqueEditionSlug` for the same fix.
function uniqueEditionSlug(): string {
	return `2100-${Math.floor(Math.random() * 1_000_000) + 1}`;
}

async function tokenFor(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok(), await login.text()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

/// A course's instructor needs a known password to log in through — unlike
/// `persistedCourseFactory`'s own auto-provisioned one, whose password is
/// random. Built by hand and handed to `persistedCourseFactory` by username,
/// the same way `api-public-refs.spec.ts`'s `makeChain` does.
async function makeInstructor() {
	const username = tag("instructor");
	return db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role: "INSTRUCTOR",
			password: PASSWORD,
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

/// A fresh course plus its instructor's bearer token and the `{ discipline,
/// course }` segment pair every case under test sends as input.
async function courseFixture(request: APIRequestContext) {
	const instructor = await makeInstructor();
	const edition = await persistedEditionFactory.create({
		slug: uniqueEditionSlug(),
	});
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: edition.slug,
	});
	const headers = await tokenFor(request, instructor.username);
	return {
		course,
		headers,
		discipline: course.discipline.slug,
		courseSegment: `${instructor.username}_${course.edition.slug}`,
	};
}

async function adminHeaders(request: APIRequestContext) {
	const login = await request.post("/api/auth/login", {
		data: { login: "admin", password: "admin" },
	});
	expect(login.ok(), await login.text()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

test("course.addStudent enrolls an existing account in the discipline/course it names", async ({
	request,
}) => {
	const { headers, discipline, courseSegment, course } =
		await courseFixture(request);
	const student = userFactory.build({ role: "STUDENT" });
	await db.user.create(student, FULL_ACCESS);

	const res = await request.post("/_actions/course.addStudent", {
		headers,
		form: { discipline, course: courseSegment, login: student.username },
	});
	expect(res.ok(), await res.text()).toBe(true);

	const enrollment = await db.enrollment.findOne(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	expect(enrollment?.status).toBe("ACTIVE");
});

test("course.dropEnrollment drops the named student from the discipline/course it names", async ({
	request,
}) => {
	const { headers, discipline, courseSegment, course } =
		await courseFixture(request);
	const student = userFactory.build({ role: "STUDENT" });
	await db.user.create(student, FULL_ACCESS);
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);

	const res = await request.post("/_actions/course.dropEnrollment", {
		headers,
		form: { discipline, course: courseSegment, username: student.username },
	});
	expect(res.ok(), await res.text()).toBe(true);

	const enrollment = await db.enrollment.findOne(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	expect(enrollment?.status).toBe("DROPPED");
});

test("course.generatePassphrase creates a passphrase for the discipline/course it names", async ({
	request,
}) => {
	const { headers, discipline, courseSegment, course } =
		await courseFixture(request);

	const res = await request.post("/_actions/course.generatePassphrase", {
		headers,
		form: { discipline, course: courseSegment, value: "TESTCODE" },
	});
	expect(res.ok(), await res.text()).toBe(true);

	const passphrases = await db.passphrase.findMany(
		{ course: course.id },
		FULL_ACCESS,
	);
	expect(passphrases.map((p) => p.value)).toContain("TESTCODE");
});

test("question.updateStatus moves a question's status in the discipline/course it names", async ({
	request,
}) => {
	const { headers, discipline, courseSegment, course } =
		await courseFixture(request);
	const question = await persistedQuestionFactory.create({
		course: course.id,
		status: "DRAFT",
	});

	const res = await request.post("/_actions/question.updateStatus", {
		headers,
		data: {
			discipline,
			course: courseSegment,
			slug: question.slug,
			status: "PUBLISHED",
		},
	});
	expect(res.ok(), await res.text()).toBe(true);

	const updated = await db.question.findOne(
		{ course: course.id, slug: question.slug, public: false },
		FULL_ACCESS,
	);
	expect(updated?.status).toBe("PUBLISHED");
});

test("auth.createClassroomInvite creates a classroom invite for the discipline/course it names", async ({
	request,
}) => {
	const { headers, discipline, courseSegment, course } =
		await courseFixture(request);

	const res = await request.post("/_actions/auth.createClassroomInvite", {
		headers,
		data: { discipline, course: courseSegment, maxUses: 5 },
	});
	expect(res.ok(), await res.text()).toBe(true);

	const invites = await db.invite.findMany(
		{ course: course.id, kind: "CLASSROOM" },
		FULL_ACCESS,
	);
	expect(invites).toHaveLength(1);
	expect(invites[0]?.maxUses).toBe(5);
});

test("auth.createPersonalInvite binds the invite to the discipline/course it names", async ({
	request,
}) => {
	const { headers, discipline, courseSegment, course } =
		await courseFixture(request);
	const email = `${tag("invitee")}@codehood.test`;

	const res = await request.post("/_actions/auth.createPersonalInvite", {
		headers,
		data: { discipline, course: courseSegment, email, role: "STUDENT" },
	});
	expect(res.ok(), await res.text()).toBe(true);

	const invites = await db.invite.findMany(
		{ course: course.id, kind: "PERSONAL" },
		FULL_ACCESS,
	);
	expect(invites.some((invite) => invite.email === email)).toBe(true);
});

test("auth.revokeApiKey deletes the key addressed by publicId", async ({
	request,
}) => {
	const { headers, course } = await courseFixture(request);
	const apiKey = await db.apiKey.create(
		{
			name: tag("key"),
			kind: "CLI",
			createdBy: {
				username: course.instructor.username,
				name: course.instructor.name,
			},
		},
		FULL_ACCESS,
	);

	const res = await request.post("/_actions/auth.revokeApiKey", {
		headers,
		form: { publicId: apiKey.publicId },
	});
	expect(res.ok(), await res.text()).toBe(true);

	const found = await db.apiKey.findOne(
		{ publicId: apiKey.publicId },
		FULL_ACCESS,
	);
	expect(found).toBeNull();
});

test("admin.revokeInvite deletes the invite addressed by publicId", async ({
	request,
}) => {
	const { course } = await courseFixture(request);
	const headers = await adminHeaders(request);
	const invite = await db.invite.create(
		{
			kind: "CLASSROOM",
			invitedRole: "STUDENT",
			email: null,
			course: course.id,
			maxUses: 5,
			createdBy: {
				username: course.instructor.username,
				name: course.instructor.name,
			},
		},
		FULL_ACCESS,
	);

	const res = await request.post("/_actions/admin.revokeInvite", {
		headers,
		form: { publicId: invite.publicId },
	});
	expect(res.ok(), await res.text()).toBe(true);

	const found = await db.invite.findOne(
		{ publicId: invite.publicId },
		FULL_ACCESS,
	);
	expect(found).toBeNull();
});
