import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedEditionFactory } from "@/fixtures/edition.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedFeedbackFactory } from "@/fixtures/feedback.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResourceFactory } from "@/fixtures/resource.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";

/**
 * `dev/specs/to-do/api-no-raw-ids.md`, REST-level behavior:
 *
 * - Invite and api-key are addressed by `publicId`, not by the numeric id
 *   the old `/[id]` route used.
 * - Every course-scoped entity's JSON body carries the public references
 *   from the spec's table (`exam`, `author`, `response`, `question`,
 *   `submission`, `grader`) and never a raw `id`/`*Id`.
 * - The submission list filter's `response` takes `{ publicId }`; a raw
 *   `response[id]` is never honored.
 */

const PASSWORD = "correct-horse-battery-staple";

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

/// `persistedEditionFactory`'s own default cycles through only 20 slugs by
/// sequence, which collides with the seeded demo editions (`2026-1`, ...) —
/// so `makeChain()` provisions its own edition with a slug far outside that
/// range instead of relying on the factory's default.
function uniqueEditionSlug(): string {
	return `2100-${Math.floor(Math.random() * 900) + 100}`;
}

async function makeUser(role: "INSTRUCTOR" | "STUDENT") {
	const username = tag(role.toLowerCase());
	return db.user.create(
		{
			email: `${username}@codehood.test`,
			username,
			name: username,
			role,
			password: PASSWORD,
			githubId: username,
			schoolId: username,
		},
		FULL_ACCESS,
	);
}

async function tokenFor(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

/// Every request in this file that needs an admin uses this session, since a
/// second `tokenFor` call in the same `request` context would overwrite the
/// bearer-outranking session cookie a prior login left behind.
async function adminHeaders(request: APIRequestContext) {
	const login = await request.post("/api/auth/login", {
		data: { login: "admin", password: "admin" },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}` };
}

/**
 * Exemptions the ruling on this spec's ambiguities carved out:
 *
 * - `publicId` is the rule's own stated exception.
 * - `githubId`/`schoolId` are external identity-provider ids, not raw
 *   database ids.
 * - `question` (the question entity's MDQ document) is exempted as a whole
 *   subtree: its choices carry author-chosen `id`s that name a choice, not a
 *   database row, so the scan never descends into it.
 */
const EXEMPT_KEYS = new Set(["publicId", "githubId", "schoolId"]);
const SKIP_SUBTREE_KEYS = new Set(["question"]);

/// `id` itself, or anything ending in `Id` — except the exemptions above.
function isRawId(key: string): boolean {
	if (EXEMPT_KEYS.has(key)) return false;
	return key === "id" || /Id$/.test(key);
}

/// Every `"a.b.c"`-style path to a `id`/`*Id` key found anywhere in `value`.
function findRawIdKeys(value: unknown, path = ""): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((item, i) => findRawIdKeys(item, `${path}[${i}]`));
	}
	if (value && typeof value === "object") {
		return Object.entries(value as Record<string, unknown>).flatMap(
			([key, v]) => {
				const here = path ? `${path}.${key}` : key;
				const hit = isRawId(key) ? [here] : [];
				if (SKIP_SUBTREE_KEYS.has(key)) return hit;
				return [...hit, ...findRawIdKeys(v, here)];
			},
		);
	}
	return [];
}

/**
 * A full chain from a fresh course down to a graded, feedback-bearing
 * submission, plus a time slot / calendar event / resource in the same
 * course, an invite bound to it, and an api-key. Everything the raw-id scan
 * and the public-reference assertions below need, built once per test.
 */
async function makeChain(request: APIRequestContext) {
	const instructor = await makeUser("INSTRUCTOR");
	const edition = await persistedEditionFactory.create({
		slug: uniqueEditionSlug(),
	});
	// `persistedCourseFactory` provisions a fresh discipline too, unlike a bare
	// `db.course.create`, which needs it to already exist.
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: edition.slug,
	});

	const question = await persistedQuestionFactory.create({ course: course.id });
	const exam = await persistedExamFactory.create({
		course: course.id,
		status: "ONGOING",
		type: "EXAM",
		questions: [{ slug: question.slug }],
	});

	const student = await makeUser("STUDENT");
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);

	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});
	const feedback = await persistedFeedbackFactory.create({
		submission: { id: submission.id },
		ref: tag("pass-"),
		grader: instructor.username,
	});

	const timeSlot = await persistedTimeSlotFactory.create({ course: course.id });
	const calendarEvent = await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: timeSlot.id,
		week: 1,
	});
	const resource = await persistedResourceFactory.create({ course: course.id });

	const invite = await db.invite.create(
		{
			kind: "PERSONAL",
			invitedRole: "STUDENT",
			email: `${tag("invitee")}@codehood.test`,
			course: course.id,
			maxUses: null,
			createdBy: { username: instructor.username, name: instructor.name },
		},
		FULL_ACCESS,
	);
	const apiKey = await db.apiKey.create(
		{
			name: tag("key"),
			kind: "CLI",
			createdBy: { username: instructor.username, name: instructor.name },
		},
		FULL_ACCESS,
	);

	const headers = await tokenFor(request, instructor.username);
	const courseUrl = `/api/course/${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}`;

	return {
		instructor,
		student,
		course,
		question,
		exam,
		response,
		submission,
		feedback,
		timeSlot,
		calendarEvent,
		resource,
		invite,
		apiKey,
		headers,
		courseUrl,
	};
}

//
// Invite: publicId in, publicId out
//

test("POST /api/invite returns a publicId and a token, never an id", async ({
	request,
}) => {
	const headers = await adminHeaders(request);
	const res = await request.post("/api/invite", {
		headers,
		data: {
			kind: "PERSONAL",
			invitedRole: "STUDENT",
			email: `${tag("invitee")}@codehood.test`,
			maxUses: null,
		},
	});
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(typeof body.publicId).toBe("string");
	expect(body.publicId.length).toBeGreaterThan(0);
	expect(typeof body.token).toBe("string");
	expect(body).not.toHaveProperty("id");
});

test("GET and DELETE /api/invite/<publicId> address the invite; a numeric id in that segment is a 404", async ({
	request,
}) => {
	const headers = await adminHeaders(request);
	const created = await request.post("/api/invite", {
		headers,
		data: {
			kind: "PERSONAL",
			invitedRole: "STUDENT",
			email: `${tag("invitee")}@codehood.test`,
			maxUses: null,
		},
	});
	expect(created.status()).toBe(200);
	const { publicId } = await created.json();

	// The old `/[id]` route is gone: a literal numeric segment names no
	// invite's publicId, so it 404s exactly like any other miss.
	const numeric = await request.get("/api/invite/1", { headers });
	expect(numeric.status()).toBe(404);

	const read = await request.get(`/api/invite/${publicId}`, { headers });
	expect(read.status()).toBe(200);
	expect((await read.json()).publicId).toBe(publicId);

	const del = await request.delete(`/api/invite/${publicId}`, { headers });
	expect(del.status()).toBe(200);

	const goneNow = await request.get(`/api/invite/${publicId}`, { headers });
	expect(goneNow.status()).toBe(404);
});

//
// Api-key: publicId in, publicId out
//

test("POST /api/api-key returns a publicId and a token, never an id", async ({
	request,
}) => {
	const headers = await adminHeaders(request);
	const admin = (
		await (await request.get("/api/user?usernames=admin", { headers })).json()
	)[0];

	const res = await request.post("/api/api-key", {
		headers,
		data: {
			name: tag("key"),
			kind: "CLI",
			createdBy: { username: admin.username, name: admin.name },
		},
	});
	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(typeof body.publicId).toBe("string");
	expect(body.publicId.length).toBeGreaterThan(0);
	expect(typeof body.token).toBe("string");
	expect(body).not.toHaveProperty("id");
});

test("GET and DELETE /api/api-key/<publicId> address the key; a numeric id in that segment is a 404", async ({
	request,
}) => {
	const headers = await adminHeaders(request);
	const admin = (
		await (await request.get("/api/user?usernames=admin", { headers })).json()
	)[0];

	const created = await request.post("/api/api-key", {
		headers,
		data: {
			name: tag("key"),
			kind: "CLI",
			createdBy: { username: admin.username, name: admin.name },
		},
	});
	expect(created.status()).toBe(200);
	const { publicId } = await created.json();

	const numeric = await request.get("/api/api-key/1", { headers });
	expect(numeric.status()).toBe(404);

	const read = await request.get(`/api/api-key/${publicId}`, { headers });
	expect(read.status()).toBe(200);
	expect((await read.json()).publicId).toBe(publicId);

	const del = await request.delete(`/api/api-key/${publicId}`, { headers });
	expect(del.status()).toBe(200);
});

//
// Every entity route: the body carries public references, never a raw id
//

test("no course-scoped or top-level entity route returns a raw id or *Id key, other than publicId", async ({
	request,
}) => {
	const chain = await makeChain(request);
	const { headers, courseUrl } = chain;

	const cases: [name: string, url: string][] = [
		["exam", `${courseUrl}/exam/${chain.exam.slug}`],
		["question", `${courseUrl}/question/${chain.question.slug}`],
		["time-slot", `${courseUrl}/time-slot/${chain.timeSlot.slug}`],
		[
			"calendar-event",
			`${courseUrl}/calendar-event/${chain.calendarEvent.week}/${chain.timeSlot.slug}`,
		],
		["resource", `${courseUrl}/resource/${chain.resource.slug}`],
		["response", `${courseUrl}/response/${chain.response.publicId}`],
		["submission", `${courseUrl}/submission/${chain.submission.publicId}`],
		[
			"feedback",
			`${courseUrl}/submission/${chain.submission.publicId}/feedback/${chain.feedback.ref}`,
		],
	];

	for (const [name, url] of cases) {
		const res = await request.get(url, { headers });
		expect(res.status(), `GET ${url}`).toBe(200);
		const body = await res.json();
		expect(findRawIdKeys(body), name).toEqual([]);
	}

	const adminAuth = await adminHeaders(request);

	const inviteRes = await request.get(`/api/invite/${chain.invite.publicId}`, {
		headers: adminAuth,
	});
	expect(inviteRes.status()).toBe(200);
	expect(findRawIdKeys(await inviteRes.json()), "invite").toEqual([]);

	const apiKeyRes = await request.get(`/api/api-key/${chain.apiKey.publicId}`, {
		headers: adminAuth,
	});
	expect(apiKeyRes.status()).toBe(200);
	expect(findRawIdKeys(await apiKeyRes.json()), "api-key").toEqual([]);
});

test("response, submission and feedback carry the public references from the spec's table", async ({
	request,
}) => {
	const chain = await makeChain(request);
	const { headers, courseUrl } = chain;

	const response = await (
		await request.get(`${courseUrl}/response/${chain.response.publicId}`, {
			headers,
		})
	).json();
	expect(response.exam).toBe(chain.exam.slug);
	expect(response.author).toBe(chain.student.username);
	expect(response).not.toHaveProperty("examSlug");
	expect(response).not.toHaveProperty("authorId");

	const submission = await (
		await request.get(`${courseUrl}/submission/${chain.submission.publicId}`, {
			headers,
		})
	).json();
	expect(submission.response).toBe(chain.response.publicId);
	expect(submission.question).toBe(chain.question.slug);

	const feedback = await (
		await request.get(
			`${courseUrl}/submission/${chain.submission.publicId}/feedback/${chain.feedback.ref}`,
			{ headers },
		)
	).json();
	expect(feedback.submission).toBe(chain.submission.publicId);
	expect(feedback.grader).toBe(chain.instructor.username);
	expect(feedback).not.toHaveProperty("graderId");
	expect(feedback).not.toHaveProperty("botId");
});

//
// Submission list filter: { publicId }, never a raw id
//

test("submission list filter's response takes { publicId } over the API; response[id] never narrows the list", async ({
	request,
}) => {
	const chain = await makeChain(request);
	const { headers, courseUrl } = chain;

	// A second response/submission in the SAME course and exam: if
	// `response[id]` were honored as a raw-id filter it would exclude this
	// one, so its presence in an "ignored" result proves the id was not used.
	const otherStudent = await makeUser("STUDENT");
	await db.enrollment.create(
		{ course: chain.course.id, username: otherStudent.username },
		FULL_ACCESS,
	);
	const otherResponse = await persistedResponseFactory.create({
		course: chain.course.id,
		exam: chain.exam.slug,
		author: otherStudent.username,
	});
	const otherSubmission = await persistedSubmissionFactory.create({
		response: { publicId: otherResponse.publicId },
		question: chain.question.slug,
	});

	const byPublicId = await request.get(
		`${courseUrl}/submission?${new URLSearchParams({
			"response[publicId]": chain.response.publicId,
		}).toString()}`,
		{ headers },
	);
	expect(byPublicId.status()).toBe(200);
	expect(
		(await byPublicId.json()).map((s: { publicId: string }) => s.publicId),
	).toEqual([chain.submission.publicId]);

	const byNumericId = await request.get(
		`${courseUrl}/submission?${new URLSearchParams({
			"response[id]": String(chain.response.id),
		}).toString()}`,
		{ headers },
	);
	if (byNumericId.status() === 400) {
		expect((await byNumericId.json()).code).toBe("invalid-data");
	} else {
		expect(byNumericId.status()).toBe(200);
		const publicIds = (await byNumericId.json()).map(
			(s: { publicId: string }) => s.publicId,
		);
		// "Ignored" means the request behaves as if `response` were never
		// filtered at all — both submissions still show up — never as if it
		// had been narrowed to `chain.response`'s numeric id specifically.
		expect(publicIds).toContain(otherSubmission.publicId);
	}
});
