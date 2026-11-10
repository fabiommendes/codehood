import { type APIRequestContext, expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import {
	createRubricScenario,
	type RubricScenario,
} from "@/fixtures/rubric-scenario";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";

/**
 * Grading rubrics over HTTP: the routes of the rubric of a question in an
 * exam, who may call them, and feedback written with `rubric`.
 *
 * Route contract the tests expect. `Q` is
 * `/api/course/[discipline]/[course]/exam/[slug]/question/[question]`.
 *
 * - `GET    Q/rubric`: the `rubricSchema` document (`base`, `initial`,
 *   `review`, `items` with `uses`). Writes nothing.
 * - `PATCH  Q/rubric` `{base}`: the updated rubric.
 * - `POST   Q/rubric/item` `{key?, group?, text, value, comment?, feedback?}`:
 *   2xx with the created item.
 * - `PATCH Q/rubric/item/[key]`: partial item, 2xx with the item.
 * - `PUT Q/rubric/item/[key]`: whole item, creates or replaces it (idempotent).
 * - `DELETE Q/rubric/item/[key]`: 2xx, also when the key is already gone.
 * - `POST   Q/rubric/item/[key]/split` `{children: [...]}`: 2xx with the
 *   array of children created.
 * - `POST   Q/rubric/rename-group` `{from, to}`: 2xx with
 *   `{renamed, warnings}`.
 * - `POST   Q/rubric/preview` `{op: "update" | "updateItem" | "deleteItem", ...}`:
 *   200 with `{passes, released}`, writes nothing.
 * - Feedback (`.../submission/[publicId]/feedback`): `PUT` on the collection
 *   and `PATCH /[ref]` accept `rubric` (keys) and `adjustment`; `score` with
 *   `rubric`, an unknown key, or two items of one top-level group answer 400.
 * - An exam that does not carry the question: 404. An actor who is not the
 *   course's instructor (student, other instructor, admin): 403.
 */

const PASSWORD = "correct-horse-battery-staple";

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function makeUser(role: "INSTRUCTOR" | "STUDENT" | "ADMIN") {
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

async function loginHeaders(request: APIRequestContext, username: string) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password: PASSWORD },
	});
	expect(login.ok()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

async function keyHeaders(
	owner: { username: string; name: string },
	kind: "BOT" | "CLI",
	name: string,
) {
	const key = await db.apiKey.create(
		{ name, kind, createdBy: { username: owner.username, name: owner.name } },
		{ actor: owner as never },
	);
	return { Authorization: `Bearer ${key.token}`, Cookie: "" };
}

/// URLs of the rubric routes of the scenario's main question.
async function urls(scenario: RubricScenario) {
	const course = await prisma.course.findUniqueOrThrow({
		where: { id: scenario.course.id },
		include: { discipline: true, edition: true },
	});
	const base = `/api/course/${course.discipline.slug}/${scenario.instructor.username}_${course.edition.slug}`;
	const rubric = `${base}/exam/${scenario.exam.slug}/question/${scenario.main.slug}/rubric`;
	return {
		base,
		rubric,
		feedback: (publicId: string) => `${base}/submission/${publicId}/feedback`,
	};
}

async function rubricRows(scenario: RubricScenario): Promise<number> {
	return prisma.rubric.count({ where: { examId: scenario.exam.id } });
}

/// A student with a password who answered the main question.
async function studentAnswer(scenario: RubricScenario) {
	const student = await makeUser("STUDENT");
	await db.enrollment.create(
		{ course: scenario.course.id, username: student.username },
		FULL_ACCESS,
	);
	const response = await persistedResponseFactory.create({
		course: scenario.course.id,
		exam: scenario.exam.slug,
		author: student.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: scenario.main.slug,
	});
	return { student, submission };
}

test("A1: a BOT key adds an item, writes a rubric pass and the score comes back computed and attributed to the bot", async ({
	request,
}) => {
	const scenario = await createRubricScenario();
	const answer = await scenario.addAnswer();
	const u = await urls(scenario);
	const headers = await keyHeaders(scenario.instructor, "BOT", "runner");

	const created = await request.post(`${u.rubric}/item`, {
		headers,
		data: { key: "a", text: "Correct", value: "0.5" },
	});
	expect(created.ok(), await created.text()).toBe(true);

	const feedback = u.feedback(answer.submission.publicId);
	const put = await request.put(feedback, {
		headers,
		data: { ref: "auto-1", rubric: ["a"], adjustment: "0.1" },
	});
	expect(put.ok(), await put.text()).toBe(true);

	const pass = await (
		await request.get(`${feedback}/auto-1`, { headers })
	).json();
	expect(pass).toMatchObject({
		score: "0.6",
		rubric: ["a"],
		adjustment: "0.1",
		bot: "runner",
		grader: null,
	});
});

test("A2: GET on a question with an initial rubric answers it flagged initial and writes nothing", async ({
	request,
}) => {
	const scenario = await createRubricScenario({
		rubric: [{ id: "r1", value: "0.5", path: "Rec/x", text: "Base case" }],
	});
	const u = await urls(scenario);
	const headers = await keyHeaders(scenario.instructor, "CLI", "laptop");

	const res = await request.get(u.rubric, { headers });

	expect(res.status()).toBe(200);
	const body = await res.json();
	expect(body.initial).toBe(true);
	expect(body.items.map((i: { key: string }) => i.key)).toEqual(["r1"]);
	expect(await rubricRows(scenario)).toBe(0);
});

test("A3: an enrolled student is refused with 403 on GET and on POST item", async ({
	request,
}) => {
	const scenario = await createRubricScenario();
	const { student } = await studentAnswer(scenario);
	const u = await urls(scenario);
	const headers = await loginHeaders(request, student.username);

	const read = await request.get(u.rubric, { headers });
	const write = await request.post(`${u.rubric}/item`, {
		headers,
		data: { text: "Hack", value: "1" },
	});

	expect(read.status()).toBe(403);
	expect(write.status()).toBe(403);
	expect(await rubricRows(scenario)).toBe(0);
});

test("A4: another course's instructor and a non-owner admin are refused with 403 on GET and PATCH, and nothing is written", async ({
	request,
}) => {
	const scenario = await createRubricScenario();
	const u = await urls(scenario);
	const outsiders = {
		instructor: await keyHeaders(await makeUser("INSTRUCTOR"), "CLI", "other"),
		admin: await keyHeaders(await makeUser("ADMIN"), "CLI", "root"),
	};

	for (const [label, headers] of Object.entries(outsiders)) {
		const read = await request.get(u.rubric, { headers });
		const write = await request.patch(u.rubric, {
			headers,
			data: { base: "0.5" },
		});
		expect(read.status(), `${label} GET`).toBe(403);
		expect(write.status(), `${label} PATCH`).toBe(403);
	}
	expect(await rubricRows(scenario)).toBe(0);
});

test("A5: a question the exam does not carry answers 404 on GET and on a write, and no rubric is stored", async ({
	request,
}) => {
	const scenario = await createRubricScenario();
	const u = await urls(scenario);
	const headers = await keyHeaders(scenario.instructor, "CLI", "laptop");
	const stray = await persistedQuestionFactory.create(
		{ course: scenario.course.id, slug: tag("stray-") },
		{ transient: { type: "essay" } },
	);
	const strayUrl = u.rubric.replace(scenario.main.slug, stray.slug);

	const read = await request.get(strayUrl, { headers });
	const write = await request.post(`${strayUrl}/item`, {
		headers,
		data: { text: "Nope", value: "0.5" },
	});

	expect(read.status()).toBe(404);
	expect(write.status()).toBe(404);
	// The router's own 404 is an HTML page; the route's NotFound is JSON.
	expect(read.headers()["content-type"]).toContain("application/json");
	expect(write.headers()["content-type"]).toContain("application/json");
	expect(await rubricRows(scenario)).toBe(0);
});

test("A6: PATCH and PUT on an item by key recompute the passes, and DELETE twice is not an error", async ({
	request,
}) => {
	const scenario = await createRubricScenario();
	const answer = await scenario.addAnswer();
	const u = await urls(scenario);
	const headers = await keyHeaders(scenario.instructor, "CLI", "laptop");
	const seeded = await scenario.seedRubric({
		items: [
			{ key: "a", value: "0.5" },
			{ key: "b", value: "0.25" },
		],
	});
	await scenario.seedPass(answer, seeded, {
		ref: "p1",
		keys: ["a", "b"],
		score: "0.75",
	});
	const feedback = `${u.feedback(answer.submission.publicId)}/p1`;
	const scoreOf = async () =>
		(await (await request.get(feedback, { headers })).json()).score;

	const patched = await request.patch(`${u.rubric}/item/a`, {
		headers,
		data: { value: "0.4" },
	});
	expect(patched.ok(), await patched.text()).toBe(true);
	expect(await scoreOf()).toBe("0.65");

	const put = await request.put(`${u.rubric}/item/b`, {
		headers,
		data: { text: "Item b", value: "0.3", group: null },
	});
	expect(put.ok(), await put.text()).toBe(true);
	expect(await scoreOf()).toBe("0.7");

	const fresh = { text: "Item c", value: "-0.1", group: "Style" };
	const created = await request.put(`${u.rubric}/item/c`, {
		headers,
		data: fresh,
	});
	expect(created.ok(), await created.text()).toBe(true);
	const again = await request.put(`${u.rubric}/item/c`, {
		headers,
		data: fresh,
	});
	expect(again.ok(), await again.text()).toBe(true);
	const rubric = await (await request.get(u.rubric, { headers })).json();
	expect(
		rubric.items.filter((item: { key: string }) => item.key === "c"),
	).toHaveLength(1);
	expect(await scoreOf()).toBe("0.7");

	const first = await request.delete(`${u.rubric}/item/a`, { headers });
	const second = await request.delete(`${u.rubric}/item/a`, { headers });
	expect(first.ok()).toBe(true);
	expect(second.ok()).toBe(true);
	expect(await scoreOf()).toBe("0.3");
});

test("A7: split creates the children and flags the pass for review; rename-group answers a warning for a near-duplicate target", async ({
	request,
}) => {
	const scenario = await createRubricScenario();
	const answer = await scenario.addAnswer();
	const u = await urls(scenario);
	const headers = await keyHeaders(scenario.instructor, "CLI", "laptop");
	const seeded = await scenario.seedRubric({
		items: [
			{ key: "x", group: null, text: "Wrong", value: "-0.5" },
			{ key: "r", group: "Rec", text: "Rec item", value: "0.25" },
			{ key: "n", group: "Recursion", text: "Other", value: "0.25" },
		],
	});
	await scenario.seedPass(answer, seeded, {
		ref: "p1",
		keys: ["x"],
		score: "0",
	});

	const split = await request.post(`${u.rubric}/item/x/split`, {
		headers,
		data: {
			children: [
				{ text: "Half", value: "-0.25" },
				{ text: "Full", value: "-0.5" },
			],
		},
	});
	expect(split.ok(), await split.text()).toBe(true);
	const children = await split.json();
	expect(children).toHaveLength(2);
	expect(children.map((c: { group: string }) => c.group)).toEqual([
		"Wrong",
		"Wrong",
	]);
	const afterSplit = await (await request.get(u.rubric, { headers })).json();
	expect(afterSplit.review).toBe(1);

	const rename = await request.post(`${u.rubric}/rename-group`, {
		headers,
		data: { from: "Rec", to: " recursion " },
	});
	expect(rename.ok(), await rename.text()).toBe(true);
	const result = await rename.json();
	expect(result.renamed).toBe(1);
	expect(result.warnings.length).toBeGreaterThan(0);
});

test("A8: preview answers the passes and released counts and leaves the rubric and the scores as they were", async ({
	request,
}) => {
	const scenario = await createRubricScenario();
	const u = await urls(scenario);
	const headers = await keyHeaders(scenario.instructor, "CLI", "laptop");
	const seeded = await scenario.seedRubric({
		items: [{ key: "a", value: "0.5" }],
	});
	const answers = [await scenario.addAnswer(), await scenario.addAnswer()];
	for (const [i, answer] of answers.entries()) {
		await scenario.seedPass(answer, seeded, {
			ref: `p${i}`,
			keys: ["a"],
			score: "0.5",
		});
	}
	const preview = (data: unknown) =>
		request.post(`${u.rubric}/preview`, { headers, data });

	const open = await preview({ op: "update", data: { base: "0.1" } });
	expect(open.status(), await open.text()).toBe(200);
	expect(await open.json()).toEqual({ passes: 2, released: 0 });

	await scenario.release();
	const released = await preview({ op: "deleteItem", key: "a" });
	expect(released.status()).toBe(200);
	expect(await released.json()).toEqual({ passes: 2, released: 2 });

	const after = await (await request.get(u.rubric, { headers })).json();
	expect(after.base).toBe("0");
	expect(after.items.map((i: { key: string }) => i.key)).toEqual(["a"]);
	const scores = await prisma.feedback.findMany({
		where: { rubricId: seeded.id },
		select: { score: true },
	});
	expect(scores.map((f) => f.score)).toEqual(["0.5", "0.5"]);
});

test("A9: feedback with score and rubric, with an unknown key, or with two items of one group answers 400 and writes nothing", async ({
	request,
}) => {
	const scenario = await createRubricScenario();
	const answer = await scenario.addAnswer();
	const u = await urls(scenario);
	const headers = await keyHeaders(scenario.instructor, "CLI", "laptop");
	await scenario.seedRubric({
		items: [
			{ key: "a", group: "Rec/Wrong", value: "-0.5" },
			{ key: "b", group: "Rec/Right", value: "0.5" },
			{ key: "c", value: "0.25" },
		],
	});
	const feedback = u.feedback(answer.submission.publicId);

	const bodies = {
		"score and rubric": { ref: "p1", score: "1", rubric: ["c"] },
		"unknown key": { ref: "p1", rubric: ["nope"] },
		"two items in one group": { ref: "p1", rubric: ["a", "b"] },
	};
	for (const [label, data] of Object.entries(bodies)) {
		const res = await request.put(feedback, { headers, data });
		expect(res.status(), label).toBe(400);
	}

	expect(
		await prisma.feedback.count({
			where: { submission: { publicId: answer.submission.publicId } },
		}),
	).toBe(0);
});

test("A10: a student reads a released rubric pass without comment and without the items that did not apply", async ({
	request,
}) => {
	const scenario = await createRubricScenario();
	const { student, submission } = await studentAnswer(scenario);
	const u = await urls(scenario);
	const instructorHeaders = await keyHeaders(
		scenario.instructor,
		"CLI",
		"laptop",
	);
	const seeded = await scenario.seedRubric({
		items: [
			{
				key: "a",
				text: "Applied item",
				value: "0.5",
				comment: "secret-comment-a",
				feedback: "shown-feedback-a",
			},
			{
				key: "b",
				text: "Unapplied item",
				value: "0.25",
				comment: "secret-comment-b",
				feedback: "shown-feedback-b",
			},
		],
	});
	const answer = { author: student, response: { publicId: "" }, submission };
	await scenario.seedPass(answer, seeded, {
		ref: "p1",
		keys: ["a"],
		score: "0.5",
	});
	await scenario.release();
	const feedback = u.feedback(submission.publicId);

	const asInstructor = await request.get(`${feedback}/p1`, {
		headers: instructorHeaders,
	});
	expect(await asInstructor.text()).toContain("secret-comment-a");

	const studentHeaders = await loginHeaders(request, student.username);
	for (const path of [feedback, `${feedback}/p1`]) {
		const res = await request.get(path, { headers: studentHeaders });
		expect(res.status(), path).toBe(200);
		const text = await res.text();
		expect(text, path).toContain("Applied item");
		expect(text, path).toContain("shown-feedback-a");
		expect(text, path).not.toContain('"comment"');
		expect(text, path).not.toContain("secret-comment");
		expect(text, path).not.toContain("Unapplied item");
		expect(text, path).not.toContain("shown-feedback-b");
	}
});
