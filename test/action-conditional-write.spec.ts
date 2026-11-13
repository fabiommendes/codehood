import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedDisciplineFactory } from "@/fixtures/discipline.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { createRubricScenario } from "@/fixtures/rubric-scenario";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { type APIRequestContext, expect, test } from "./fixtures";
import { parseDevalue } from "./helpers/devalue-lite";
import { seedUser } from "./stories/helpers";
import { REGRADE_MESSAGE, releasedExam } from "./stories/regrade-setup";

/**
 * ADR 0013 on the Astro Actions that edit one entity: the page sends the
 * `updatedAt` it loaded, a stale one answers 412 with the text the island
 * shows and writes nothing, an absent one writes as before, and the action
 * hands back the new version so a second edit on the same page goes through.
 *
 * Every test builds its own rows: no `resetDatabase`, nothing from the seed.
 */

const STALE = new Date(0).toISOString();
const STALE_TEXT = "Someone changed this since you opened the page";

/// A user that can log in over the REST API: its password is known.
const PASSWORD = "correct-horse-battery-staple";

async function bearer(
	request: APIRequestContext,
	username: string,
	password: string,
) {
	const login = await request.post("/api/auth/login", {
		data: { login: username, password },
	});
	expect(login.ok(), await login.text()).toBe(true);
	const { token } = await login.json();
	return { Authorization: `Bearer ${token}`, Cookie: "" };
}

/// Posts an action as JSON, or as a form for `accept: "form"` ones; a success body is decoded, an error body is plain JSON. An action that returns nothing answers 204.
async function call(
	request: APIRequestContext,
	name: string,
	headers: Record<string, string>,
	data: Record<string, unknown>,
	as: "json" | "form" = "json",
) {
	const response = await request.post(`/_actions/${name}`, {
		headers,
		...(as === "form" ? { form: data as Record<string, string> } : { data }),
	});
	const text = await response.text();
	const ok = response.status() === 200;
	if (response.status() === 204) return { status: 204, body: undefined, text };
	return {
		status: response.status(),
		body: (ok && text ? parseDevalue(text) : JSON.parse(text || "null")) as
			| Record<string, unknown>
			| undefined,
		text,
	};
}

/// An instructor with a known password, owner of a fresh course.
async function instructorWorld() {
	const instructor = await seedUser({
		role: "INSTRUCTOR",
		password: PASSWORD,
	});
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	return {
		instructor,
		course,
		segments: {
			discipline: course.discipline.slug,
			course: `${course.instructor.username}_${course.edition.slug}`,
		},
	};
}

test("admin.updateDiscipline: a stale version answers 412 and writes nothing, the loaded one writes", async ({
	request,
}) => {
	const admin = await seedUser({ role: "ADMIN", password: PASSWORD });
	const headers = await bearer(request, admin.username, PASSWORD);
	const discipline = await persistedDisciplineFactory.create();

	const stale = await call(
		request,
		"admin.updateDiscipline",
		headers,
		{
			slug: discipline.slug,
			name: "Stale name",
			updatedAt: STALE,
		},
		"form",
	);
	expect(stale.status).toBe(412);
	expect(stale.text).toContain(STALE_TEXT);
	expect(
		(await db.discipline.findOne({ slug: discipline.slug }, FULL_ACCESS))?.name,
	).toBe(discipline.name);

	const fresh = await call(
		request,
		"admin.updateDiscipline",
		headers,
		{
			slug: discipline.slug,
			name: "Fresh name",
			updatedAt: discipline.updatedAt.toISOString(),
		},
		"form",
	);
	expect(fresh.status, fresh.text).toBeLessThan(300);

	const unconditional = await call(
		request,
		"admin.updateDiscipline",
		headers,
		{
			slug: discipline.slug,
			name: "Unconditional name",
		},
		"form",
	);
	expect(unconditional.status, unconditional.text).toBeLessThan(300);
	expect(
		(await db.discipline.findOne({ slug: discipline.slug }, FULL_ACCESS))?.name,
	).toBe("Unconditional name");
});

test("question.updateStatus: a stale version answers 412, and the version it returns serves the next edit", async ({
	request,
}) => {
	const { instructor, course, segments } = await instructorWorld();
	const headers = await bearer(request, instructor.username, PASSWORD);
	const question = await persistedQuestionFactory.create(
		{ course: course.id, status: "DRAFT" },
		{ transient: { type: "essay" } },
	);
	const target = { ...segments, slug: question.slug };

	const stale = await call(request, "question.updateStatus", headers, {
		...target,
		status: "PUBLISHED",
		updatedAt: STALE,
	});
	expect(stale.status).toBe(412);
	expect(stale.text).toContain(STALE_TEXT);

	const first = await call(request, "question.updateStatus", headers, {
		...target,
		status: "PUBLISHED",
		updatedAt: question.updatedAt.toISOString(),
	});
	expect(first.status, first.text).toBe(200);
	const version = first.body?.updatedAt as Date;
	expect(version.getTime()).toBeGreaterThan(question.updatedAt.getTime());

	const second = await call(request, "question.updateStatus", headers, {
		...target,
		status: "HIDDEN",
		updatedAt: version.toISOString(),
	});
	expect(second.status, second.text).toBe(200);

	const replay = await call(request, "question.updateStatus", headers, {
		...target,
		status: "DRAFT",
		updatedAt: version.toISOString(),
	});
	expect(replay.status).toBe(412);
});

test("report.triage: a stale version answers 412, and the version it returns serves the next edit", async ({
	request,
}) => {
	const admin = await seedUser({ role: "ADMIN", password: PASSWORD });
	const author = await persistedUserFactory.create({ role: "STUDENT" });
	const headers = await bearer(request, admin.username, PASSWORD);
	const report = await db.report.create(
		{ kind: "BUG", message: "Something is off", attachments: [] },
		{ actor: author },
	);

	const stale = await call(request, "report.triage", headers, {
		publicId: report.publicId,
		status: "TRIAGED",
		updatedAt: STALE,
	});
	expect(stale.status).toBe(412);
	expect(stale.text).toContain(STALE_TEXT);

	const first = await call(request, "report.triage", headers, {
		publicId: report.publicId,
		status: "TRIAGED",
		updatedAt: report.updatedAt.toISOString(),
	});
	expect(first.status, first.text).toBe(200);
	const version = first.body?.updatedAt as Date;

	const second = await call(request, "report.triage", headers, {
		publicId: report.publicId,
		status: "RESOLVED",
		updatedAt: version.toISOString(),
	});
	expect(second.status, second.text).toBeLessThan(300);
});

test("regrade.accept and reject: a stale version answers 412 and leaves the request open", async ({
	request,
}) => {
	const world = await releasedExam("act-cond-regrade", 1);
	const [student] = world.students;
	if (!student) throw new Error("no student");
	const counting = await db.submission.findMany(
		{ course: world.course.id },
		FULL_ACCESS,
	);
	const created = await db.regradeRequest.create(
		{
			course: world.course.id,
			submission: counting[0]?.publicId ?? "",
			message: REGRADE_MESSAGE,
		},
		{ actor: student },
	);
	const headers = await bearer(
		request,
		world.teacher.username,
		world.teacher.password,
	);
	const url = {
		discipline: world.course.discipline.slug,
		course: `${world.course.instructor.username}_${world.course.edition.slug}`,
		exam: world.exam.slug,
		request: created.publicId,
	};

	const accept = await call(request, "regrade.accept", headers, {
		...url,
		score: "100",
		reply: "ok",
		updatedAt: STALE,
	});
	expect(accept.status).toBe(412);
	expect(accept.text).toContain(STALE_TEXT);
	const reject = await call(request, "regrade.reject", headers, {
		...url,
		reply: "no",
		updatedAt: STALE,
	});
	expect(reject.status).toBe(412);
	const still = await db.regradeRequest.findOne(
		{ publicId: created.publicId, course: world.course.id },
		FULL_ACCESS,
	);
	expect(still?.status).toBe("OPEN");

	const done = await call(request, "regrade.reject", headers, {
		...url,
		reply: "no",
		updatedAt: created.updatedAt.toISOString(),
	});
	expect(done.status, done.text).toBe(204);
});

/// A rubric of two items and one answer graded by the instructor, reached over the actions.
async function rubricWorld() {
	const scenario = await createRubricScenario();
	await db.user.resetPassword(
		{ username: scenario.instructor.username, newPassword: PASSWORD },
		FULL_ACCESS,
	);
	await scenario.seedRubric({
		items: [
			{ key: "a", group: "G/One", value: "0.5" },
			{ key: "b", value: "0.25" },
		],
	});
	const course = await db.course.findOne(
		{ id: scenario.course.id },
		FULL_ACCESS,
	);
	if (!course) throw new Error("no course");
	const target = {
		discipline: course.discipline.slug,
		course: `${course.instructor.username}_${course.edition.slug}`,
		exam: scenario.exam.slug,
		question: scenario.main.slug,
	};
	return { scenario, target };
}

/// The rubric state the grading view loads: versions of the rubric and of its items as ISO text.
async function stateOf(
	request: APIRequestContext,
	headers: Record<string, string>,
	target: Record<string, unknown>,
) {
	const state = await call(request, "grading.state", headers, target);
	expect(state.status, state.text).toBe(200);
	return state.body as {
		updatedAt: string | null;
		items: { key: string; updatedAt: string | null }[];
		answers: {
			submission: string;
			ref: string | null;
			updatedAt: string | null;
		}[];
	};
}

test("rubric actions: a stale version answers 412, the state carries the versions, edits in a row go through", async ({
	request,
}) => {
	const { scenario, target } = await rubricWorld();
	const headers = await bearer(request, scenario.instructor.username, PASSWORD);

	const state = await stateOf(request, headers, target);
	expect(state.updatedAt).not.toBeNull();
	const a = state.items.find((item) => item.key === "a");
	expect(a?.updatedAt).not.toBeNull();

	// Every action refuses a stale version with the text of the island.
	for (const [name, data] of [
		["rubric.addItem", { text: "New", value: "0.1" }],
		["rubric.splitItem", { key: "a", children: [{ text: "x", value: "0.5" }] }],
		["rubric.renameGroup", { from: "G", to: "H" }],
		["rubric.edit", { base: "0.5" }],
		["rubric.edit", { items: [{ key: "a", value: "0.4", updatedAt: STALE }] }],
		["rubric.edit", { deleted: [{ key: "b", updatedAt: STALE }] }],
	] as const) {
		const stale = await call(request, name, headers, {
			...target,
			updatedAt: STALE,
			...data,
		});
		expect(stale.status, `${name} ${JSON.stringify(data)}`).toBe(412);
		expect(stale.text).toContain(STALE_TEXT);
	}
	expect((await stateOf(request, headers, target)).items).toHaveLength(2);

	// The item's own version guards an item edit, not the rubric's.
	const itemEdit = await call(request, "rubric.edit", headers, {
		...target,
		items: [{ key: "a", value: "0.4", updatedAt: a?.updatedAt }],
	});
	expect(itemEdit.status, itemEdit.text).toBe(200);

	// The rubric moved, so its old version is stale, and the reloaded one is not.
	const old = await call(request, "rubric.addItem", headers, {
		...target,
		text: "Late",
		value: "0.1",
		updatedAt: state.updatedAt,
	});
	expect(old.status).toBe(412);

	const reloaded = await stateOf(request, headers, target);
	const added = await call(request, "rubric.addItem", headers, {
		...target,
		text: "Fresh",
		value: "0.1",
		updatedAt: reloaded.updatedAt,
	});
	expect(added.status, added.text).toBe(200);

	// A second edit with the version of a write the page does not know about fails.
	const again = await call(request, "rubric.renameGroup", headers, {
		...target,
		from: "G",
		to: "H",
		updatedAt: reloaded.updatedAt,
	});
	expect(again.status).toBe(412);

	const last = await stateOf(request, headers, target);
	const renamed = await call(request, "rubric.renameGroup", headers, {
		...target,
		from: "G",
		to: "H",
		updatedAt: last.updatedAt,
	});
	expect(renamed.status, renamed.text).toBe(200);
});

test("grading.gradeRubric: the version of the pass revised guards the save, a new pass takes none", async ({
	request,
}) => {
	const { scenario, target } = await rubricWorld();
	const headers = await bearer(request, scenario.instructor.username, PASSWORD);
	const answer = await scenario.addAnswer();
	await scenario.close();
	const grade = (extra: Record<string, unknown>) =>
		call(request, "grading.gradeRubric", headers, {
			discipline: target.discipline,
			course: target.course,
			exam: target.exam,
			submission: answer.submission.publicId,
			rubric: ["a"],
			...extra,
		});

	const created = await grade({ updatedAt: STALE });
	expect(created.status, "a pass without ref is new").toBe(204);

	const state = await stateOf(request, headers, target);
	const mine = state.answers.find(
		(entry) => entry.submission === answer.submission.publicId,
	);
	expect(mine?.ref).toBeTruthy();
	expect(mine?.updatedAt).toBeTruthy();

	const stale = await grade({ ref: mine?.ref, updatedAt: STALE });
	expect(stale.status).toBe(412);
	expect(stale.text).toContain(STALE_TEXT);

	const fresh = await grade({
		ref: mine?.ref,
		rubric: ["b"],
		updatedAt: mine?.updatedAt,
	});
	expect(fresh.status, fresh.text).toBeLessThan(300);

	const after = await stateOf(request, headers, target);
	const next = after.answers.find(
		(entry) => entry.submission === answer.submission.publicId,
	);
	expect(next?.updatedAt).not.toBe(mine?.updatedAt);
	const second = await grade({
		ref: mine?.ref,
		rubric: ["a", "b"],
		updatedAt: next?.updatedAt,
	});
	expect(second.status, second.text).toBeLessThan(300);
});
