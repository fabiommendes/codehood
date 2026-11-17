import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { NotAllowed } from "@/core/error";
import { isoDate } from "@/core/schemas/base";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { sumCode } from "@/mdq/fixtures";

// Sending the same code twice must not cost a send: the second one answers with
// the first, its job and its report.

function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2094-1"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startDate: isoDate.parse("2026-01-01"),
				endDate: isoDate.parse("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

/// An enrolled student (or the instructor, with `preview`) in an open exam with one hosted `code` question.
async function setup({
	type = "EXAM",
	attempts,
	preview = false,
}: {
	type?: "EXAM" | "PRACTICE";
	attempts?: number;
	preview?: boolean;
} = {}) {
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
			question: {
				...sumCode,
				meta: { worker: "elm-test", ...(attempts ? { attempts } : {}) },
			},
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
	const actor = preview ? instructor : student;
	return {
		exam,
		send: (payload: string, kind: "AUTOSAVE" | "SUBMIT" = "SUBMIT") =>
			db.response.submit(
				{ course: course.id, exam: exam.slug, question: slug, payload, kind },
				{ actor },
			),
	};
}

type Ctx = Awaited<ReturnType<typeof setup>>;

const jobsOf = (ctx: Ctx) =>
	prisma.gradingJob.findMany({
		where: { submission: { response: { examId: ctx.exam.id } } },
		orderBy: { id: "asc" },
		include: { submission: true },
	});

const sentOf = (ctx: Ctx) =>
	prisma.submission.findMany({
		where: {
			response: { examId: ctx.exam.id },
			kind: { in: ["SUBMIT", "FINAL"] },
		},
		orderBy: { id: "asc" },
	});

/// Sets the state of job number `index`, as a worker or the queue would.
async function setJob(
	ctx: Ctx,
	index: number,
	state: "QUEUED" | "CLAIMED" | "DONE" | "FAILED",
	status?: "PRETEST_FAILED" | "GRADED_AUTOMATICALLY",
) {
	const job = (await jobsOf(ctx))[index];
	if (!job) throw new Error("no job");
	await prisma.gradingJob.update({ where: { id: job.id }, data: { state } });
	if (status) {
		await prisma.submission.update({
			where: { id: job.submission.id },
			data: { status },
		});
	}
}

test("the same code sent twice creates no submission and no job", async () => {
	const ctx = await setup();
	const first = await ctx.send("a");
	const second = await ctx.send("a");

	expect(first.duplicate).toBe(false);
	expect(second.duplicate).toBe(true);
	expect(await sentOf(ctx)).toHaveLength(1);
	expect(await jobsOf(ctx)).toHaveLength(1);
	expect(second.submissions.filter((s) => s.kind === "SUBMIT")).toHaveLength(1);
});

test("a duplicate spends no send, whatever the limit", async () => {
	const ctx = await setup({ attempts: 2 });
	await ctx.send("a");
	await setJob(ctx, 0, "DONE", "GRADED_AUTOMATICALLY");
	// The only send left is still there after any number of repeats.
	for (let i = 0; i < 3; i++) {
		expect((await ctx.send("a")).duplicate).toBe(true);
	}
	await expect(ctx.send("b")).resolves.toMatchObject({ duplicate: false });
	await setJob(ctx, 1, "DONE", "GRADED_AUTOMATICALLY");
	// Sends spent: a new text is refused, an old one is still answered.
	await expect(ctx.send("c")).rejects.toBeInstanceOf(NotAllowed);
	await expect(ctx.send("a")).resolves.toMatchObject({ duplicate: true });
	expect(await sentOf(ctx)).toHaveLength(2);
});

test("A, B, A: the third matches the first, not just the last", async () => {
	const ctx = await setup();
	await ctx.send("a");
	await setJob(ctx, 0, "DONE", "GRADED_AUTOMATICALLY");
	await ctx.send("b");
	await setJob(ctx, 1, "DONE", "GRADED_AUTOMATICALLY");

	const third = await ctx.send("a");
	expect(third.duplicate).toBe(true);
	expect((await sentOf(ctx)).map((s) => s.payload)).toEqual(["a", "b"]);
	expect(await jobsOf(ctx)).toHaveLength(2);
});

test("a duplicate of a send still queued or running returns that job", async () => {
	const ctx = await setup();
	await ctx.send("a");
	expect((await ctx.send("a")).duplicate).toBe(true);
	await setJob(ctx, 0, "CLAIMED");
	// A claimed job refuses a different text, but answers the same one.
	await expect(ctx.send("b")).rejects.toBeInstanceOf(NotAllowed);
	expect((await ctx.send("a")).duplicate).toBe(true);

	const jobs = await jobsOf(ctx);
	expect(jobs).toHaveLength(1);
	expect(jobs[0]?.state).toBe("CLAIMED");
});

test("a job that failed or was cancelled does not stand for its code: the resend queues a new job", async () => {
	const ctx = await setup();
	await ctx.send("a");
	await setJob(ctx, 0, "FAILED");
	expect((await ctx.send("a")).duplicate).toBe(false);
	// The second job is replaced by a different text, which cancels it.
	await ctx.send("b");
	expect((await jobsOf(ctx)).map((j) => j.state)).toEqual([
		"FAILED",
		"CANCELLED",
		"QUEUED",
	]);
	expect((await ctx.send("a")).duplicate).toBe(false);
	expect(await jobsOf(ctx)).toHaveLength(4);
});

test("a send that failed its pretest is answered with its own report", async () => {
	const ctx = await setup();
	await ctx.send("a");
	await setJob(ctx, 0, "DONE", "PRETEST_FAILED");
	expect((await ctx.send("a")).duplicate).toBe(true);
	expect(await jobsOf(ctx)).toHaveLength(1);
});

test("the text is compared as it is: any difference is a new send", async () => {
	const ctx = await setup();
	await ctx.send("a");
	await setJob(ctx, 0, "DONE", "GRADED_AUTOMATICALLY");
	expect((await ctx.send("a ")).duplicate).toBe(false);
	await setJob(ctx, 1, "DONE", "GRADED_AUTOMATICALLY");
	expect((await ctx.send("a\n")).duplicate).toBe(false);
});

test("an autosave of the same text is neither a send nor a duplicate of one", async () => {
	const ctx = await setup();
	await ctx.send("a");
	const saved = await ctx.send("a", "AUTOSAVE");
	expect(saved.duplicate).toBe(false);
	expect(saved.submissions.map((s) => s.kind)).toEqual(["SUBMIT", "AUTOSAVE"]);
});

test("a practice exam answers a duplicate too, to spare the worker", async () => {
	const ctx = await setup({ type: "PRACTICE" });
	await ctx.send("a");
	await setJob(ctx, 0, "DONE", "GRADED_AUTOMATICALLY");
	expect((await ctx.send("a")).duplicate).toBe(true);
	expect(await jobsOf(ctx)).toHaveLength(1);
	expect((await ctx.send("b")).duplicate).toBe(false);
});

test("the instructor's simulation answers a duplicate too", async () => {
	const ctx = await setup({ preview: true });
	await ctx.send("a");
	await setJob(ctx, 0, "DONE", "GRADED_AUTOMATICALLY");
	expect((await ctx.send("a")).duplicate).toBe(true);
	expect(await jobsOf(ctx)).toHaveLength(1);
});
