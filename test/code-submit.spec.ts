import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotAllowed } from "@/core/error";
import { db, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { sumCode } from "@/mdq/fixtures";

// Sending a `code` answer to a worker, and what closing the attempt does to
// the last autosave. Autosave must never be touched by any of it.

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2094-1"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

interface Setup {
	type?: "EXAM" | "PRACTICE";
	meta?: Record<string, unknown> | null;
}

/// An enrolled student in an open exam with one hosted `code` question.
async function setup({
	type = "EXAM",
	meta = { worker: "elm-test" },
}: Setup = {}) {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slug = tag("code-");
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			rev: null,
			question: { ...sumCode, ...(meta ? { meta } : {}) },
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		status: "ONGOING",
		type,
		questions: [{ slug }],
	});
	const input = (
		payload: string,
		kind?: "AUTOSAVE" | "SUBMIT",
		question = slug,
	) => ({
		course: course.id,
		exam: exam.slug,
		question,
		payload,
		...(kind ? { kind } : {}),
	});
	return {
		course,
		exam,
		student,
		slug,
		save: (payload: string, kind?: "AUTOSAVE" | "SUBMIT") =>
			db.response.submit(input(payload, kind), { actor: student }),
		finish: () =>
			db.response.finish(
				{ course: course.id, exam: exam.slug },
				{ actor: student },
			),
		input,
	};
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const jobsOf = (ctx: Ctx) =>
	prisma.gradingJob.findMany({
		where: { submission: { response: { examId: ctx.exam.id } } },
		orderBy: { id: "asc" },
		include: { submission: true },
	});

const submissionsOf = (ctx: Ctx) =>
	prisma.submission.findMany({
		where: { response: { examId: ctx.exam.id } },
		orderBy: { id: "asc" },
	});

/// Sets the state of the newest job, as a worker or the queue would.
async function setLastJob(
	ctx: Ctx,
	state: "QUEUED" | "CLAIMED" | "DONE" | "FAILED",
	status?: "PRETEST_FAILED" | "GRADED_AUTOMATICALLY",
) {
	const jobs = await jobsOf(ctx);
	const job = jobs[jobs.length - 1];
	if (!job) throw new Error("no job");
	await prisma.gradingJob.update({ where: { id: job.id }, data: { state } });
	if (status) {
		await prisma.submission.update({
			where: { id: job.submission.id },
			data: { status },
		});
	}
}

//
// Sending
//

test("an autosave is the default, carries kind AUTOSAVE and queues nothing", async () => {
	const ctx = await setup();
	const response = await ctx.save("a");

	expect(response.submissions.map((s) => s.kind)).toEqual(["AUTOSAVE"]);
	expect(await jobsOf(ctx)).toHaveLength(0);
});

test("SUBMIT stores a SUBMIT submission and a QUEUED job with the question's worker", async () => {
	const ctx = await setup({ meta: { worker: "elm-test" } });
	const response = await ctx.save("a", "SUBMIT");

	expect(response.submissions.map((s) => s.kind)).toEqual(["SUBMIT"]);
	const jobs = await jobsOf(ctx);
	expect(jobs).toHaveLength(1);
	expect(jobs[0]).toMatchObject({
		worker: "elm-test",
		state: "QUEUED",
		attempts: 0,
	});
	expect(jobs[0]?.submission).toMatchObject({ kind: "SUBMIT", payload: "a" });
});

test("SUBMIT is refused on a code question without a worker, and stores nothing", async () => {
	const ctx = await setup({ meta: null });
	await expect(ctx.save("a", "SUBMIT")).rejects.toBeInstanceOf(InvalidData);
	expect(await submissionsOf(ctx)).toHaveLength(0);
	await expect(ctx.save("a")).resolves.toBeDefined();
});

test("SUBMIT is refused on a question that is not code", async () => {
	const ctx = await setup();
	const essay = await persistedQuestionFactory.create({
		course: ctx.course.id,
		slug: tag("essay-"),
	});
	await db.exam.update(
		{ course: ctx.course.id, slug: ctx.exam.slug },
		{ questions: [{ slug: ctx.slug }, { slug: essay.slug }] },
		FULL_ACCESS,
	);
	await expect(
		db.response.submit(
			{
				course: ctx.course.id,
				exam: ctx.exam.slug,
				question: essay.slug,
				payload: null,
				kind: "SUBMIT",
			},
			{ actor: ctx.student },
		),
	).rejects.toBeInstanceOf(InvalidData);
});

test("FINAL is not accepted from outside", async () => {
	const ctx = await setup();
	await expect(
		db.response.submit(
			{ ...ctx.input("a"), kind: "FINAL" as never },
			{ actor: ctx.student },
		),
	).rejects.toBeInstanceOf(InvalidData);
	expect(await submissionsOf(ctx)).toHaveLength(0);
});

//
// Replacing and waiting
//

test("a SUBMIT cancels the QUEUED job of the previous one", async () => {
	const ctx = await setup();
	await ctx.save("a", "SUBMIT");
	await ctx.save("b", "SUBMIT");

	const jobs = await jobsOf(ctx);
	expect(jobs.map((j) => j.state)).toEqual(["CANCELLED", "QUEUED"]);
});

test("a cancelled job does not spend a send", async () => {
	const ctx = await setup({ meta: { worker: "w", attempts: 1 } });
	await ctx.save("a", "SUBMIT");
	await ctx.save("b", "SUBMIT");
	await ctx.save("c", "SUBMIT");
	expect((await jobsOf(ctx)).map((j) => j.state)).toEqual([
		"CANCELLED",
		"CANCELLED",
		"QUEUED",
	]);
});

test("a SUBMIT is refused with 409 while the previous job is CLAIMED, writing nothing", async () => {
	const ctx = await setup();
	await ctx.save("a", "SUBMIT");
	await setLastJob(ctx, "CLAIMED");

	const refused = ctx.save("b", "SUBMIT");
	await expect(refused).rejects.toBeInstanceOf(NotAllowed);
	await expect(refused).rejects.toMatchObject({ status: 409 });
	expect(await submissionsOf(ctx)).toHaveLength(1);
	expect((await jobsOf(ctx)).map((j) => j.state)).toEqual(["CLAIMED"]);
});

//
// Sends left
//

test("a SUBMIT is refused with 409 once the sends are spent", async () => {
	const ctx = await setup({ meta: { worker: "w", attempts: 2 } });
	for (const text of ["a", "b"]) {
		await ctx.save(text, "SUBMIT");
		await setLastJob(ctx, "DONE", "GRADED_AUTOMATICALLY");
	}

	const refused = ctx.save("c", "SUBMIT");
	await expect(refused).rejects.toBeInstanceOf(NotAllowed);
	await expect(refused).rejects.toMatchObject({ status: 409 });
	expect(await submissionsOf(ctx)).toHaveLength(2);
});

test("the default is four sends", async () => {
	const ctx = await setup({ meta: { worker: "w" } });
	for (const text of ["a", "b", "c", "d"]) {
		await ctx.save(text, "SUBMIT");
		await setLastJob(ctx, "DONE", "GRADED_AUTOMATICALLY");
	}
	await expect(ctx.save("e", "SUBMIT")).rejects.toMatchObject({ status: 409 });
});

test("a failed pretest and a FAILED job do not spend a send", async () => {
	const ctx = await setup({ meta: { worker: "w", attempts: 1 } });
	await ctx.save("a", "SUBMIT");
	await setLastJob(ctx, "DONE", "PRETEST_FAILED");
	await ctx.save("b", "SUBMIT");
	await setLastJob(ctx, "FAILED");

	await expect(ctx.save("c", "SUBMIT")).resolves.toBeDefined();
});

test("a practice exam has unlimited sends", async () => {
	const ctx = await setup({
		type: "PRACTICE",
		meta: { worker: "w", attempts: 1 },
	});
	for (const text of ["a", "b", "c"]) {
		await ctx.save(text, "SUBMIT");
		await setLastJob(ctx, "DONE", "GRADED_AUTOMATICALLY");
	}
	await expect(ctx.save("d", "SUBMIT")).resolves.toBeDefined();
});

//
// Autosave never fails
//

test("an autosave works while a job is CLAIMED", async () => {
	const ctx = await setup();
	await ctx.save("a", "SUBMIT");
	await setLastJob(ctx, "CLAIMED");

	await expect(ctx.save("typing")).resolves.toBeDefined();
	expect((await jobsOf(ctx)).map((j) => j.state)).toEqual(["CLAIMED"]);
});

test("an autosave works with the sends spent", async () => {
	const ctx = await setup({ meta: { worker: "w", attempts: 1 } });
	await ctx.save("a", "SUBMIT");
	await setLastJob(ctx, "DONE", "GRADED_AUTOMATICALLY");

	await expect(ctx.save("typing")).resolves.toBeDefined();
});

test("an autosave works with a QUEUED job and does not cancel it", async () => {
	const ctx = await setup();
	await ctx.save("a", "SUBMIT");

	await expect(ctx.save("typing")).resolves.toBeDefined();
	expect((await jobsOf(ctx)).map((j) => j.state)).toEqual(["QUEUED"]);
});

test("a refused SUBMIT leaves the autosave that came before it", async () => {
	const ctx = await setup();
	await ctx.save("a", "SUBMIT");
	await setLastJob(ctx, "CLAIMED");
	await ctx.save("draft");
	await expect(ctx.save("draft", "SUBMIT")).rejects.toMatchObject({
		status: 409,
	});

	const kept = await submissionsOf(ctx);
	expect(kept.map((s) => [s.kind, s.payload])).toEqual([
		["SUBMIT", "a"],
		["AUTOSAVE", "draft"],
	]);
});

//
// Closing the attempt
//

/// Closes the attempt the way the instructor does, which also works on a practice session.
async function closeByUpdate(ctx: Ctx) {
	const response = await db.response.findMany(
		{ course: ctx.course.id, exam: ctx.exam.slug },
		FULL_ACCESS,
	);
	return db.response.update(
		{ id: response[0]?.id as schema.ResponseId },
		{ acceptingSubmissions: false },
		FULL_ACCESS,
	);
}

const closers: [string, (ctx: Ctx) => Promise<unknown>][] = [
	["finish", (ctx) => ctx.finish()],
	["update acceptingSubmissions=false", closeByUpdate],
	[
		"upsert acceptingSubmissions=false",
		(ctx) =>
			db.response.upsert(
				{
					course: ctx.course.id,
					exam: ctx.exam.slug,
					author: ctx.student.username,
					acceptingSubmissions: false,
				},
				FULL_ACCESS,
			),
	],
];

for (const [name, close] of closers) {
	test(`closing (${name}) promotes a differing autosave to FINAL with a job`, async () => {
		const ctx = await setup();
		await ctx.save("a", "SUBMIT");
		await ctx.save("b");
		await close(ctx);

		const submissions = await submissionsOf(ctx);
		expect(submissions.map((s) => [s.kind, s.payload])).toEqual([
			["SUBMIT", "a"],
			["AUTOSAVE", "b"],
			["FINAL", "b"],
		]);
		const jobs = await jobsOf(ctx);
		expect(jobs.map((j) => j.state)).toEqual(["CANCELLED", "QUEUED"]);
		expect(jobs[1]).toMatchObject({ worker: "elm-test" });
		expect(jobs[1]?.submission.kind).toBe("FINAL");
	});
}

test("closing promotes the autosave of a question never sent", async () => {
	const ctx = await setup();
	await ctx.save("only");
	await ctx.finish();

	expect((await submissionsOf(ctx)).map((s) => s.kind)).toEqual([
		"AUTOSAVE",
		"FINAL",
	]);
	expect(await jobsOf(ctx)).toHaveLength(1);
});

test("closing promotes nothing when the autosave equals the last send", async () => {
	const ctx = await setup();
	await ctx.save("a", "SUBMIT");
	await ctx.save("a");
	await ctx.finish();

	expect((await submissionsOf(ctx)).map((s) => s.kind)).toEqual([
		"SUBMIT",
		"AUTOSAVE",
	]);
	expect((await jobsOf(ctx)).map((j) => j.state)).toEqual(["QUEUED"]);
});

test("closing promotes nothing when there is no autosave", async () => {
	const ctx = await setup();
	await ctx.save("a", "SUBMIT");
	await setLastJob(ctx, "DONE", "GRADED_AUTOMATICALLY");
	await ctx.finish();
	expect(await submissionsOf(ctx)).toHaveLength(1);
});

test("closing promotes nothing while a job is CLAIMED", async () => {
	const ctx = await setup();
	await ctx.save("a", "SUBMIT");
	await setLastJob(ctx, "CLAIMED");
	await ctx.save("b");
	await ctx.finish();

	expect((await submissionsOf(ctx)).map((s) => s.kind)).toEqual([
		"SUBMIT",
		"AUTOSAVE",
	]);
});

test("closing promotes nothing when the sends are spent", async () => {
	const ctx = await setup({ meta: { worker: "w", attempts: 1 } });
	await ctx.save("a", "SUBMIT");
	await setLastJob(ctx, "DONE", "GRADED_AUTOMATICALLY");
	await ctx.save("b");
	await ctx.finish();

	expect((await submissionsOf(ctx)).map((s) => s.kind)).toEqual([
		"SUBMIT",
		"AUTOSAVE",
	]);
});

test("closing promotes nothing on a question without a worker", async () => {
	const ctx = await setup({ meta: null });
	await ctx.save("a");
	await ctx.finish();
	expect((await submissionsOf(ctx)).map((s) => s.kind)).toEqual(["AUTOSAVE"]);
});

test("closing a practice attempt still promotes, with no send limit", async () => {
	const ctx = await setup({
		type: "PRACTICE",
		meta: { worker: "w", attempts: 1 },
	});
	await ctx.save("a", "SUBMIT");
	await setLastJob(ctx, "DONE", "GRADED_AUTOMATICALLY");
	await ctx.save("b");
	await closeByUpdate(ctx);

	expect((await submissionsOf(ctx)).map((s) => s.kind)).toEqual([
		"SUBMIT",
		"AUTOSAVE",
		"FINAL",
	]);
});

test("closing twice promotes once", async () => {
	const ctx = await setup();
	await ctx.save("a");
	await ctx.finish();
	await ctx.finish();
	expect(
		(await submissionsOf(ctx)).filter((s) => s.kind === "FINAL"),
	).toHaveLength(1);
});
