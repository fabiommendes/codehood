import { expect, test } from "@playwright/test";
import { FULL_ACCESS, type UserActor } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type { CourseId } from "@/core/schemas";
import { db, type User } from "@/db";
import { prisma } from "@/db/client";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { code } from "@/mdq/fixtures";
import {
	actorOf,
	enroll,
	makeCourse,
	makeExam,
	tag,
} from "./conditional-write-exam-support";

//
// Fixtures: courses, code questions, submissions and jobs are created per
// test under random keys, straight through Prisma where the submission
// service is not the subject.
//

const SOURCE = [
	"import pytest", // 1
	"", // 2
	"# mdq: [0] {public} Runs the example", // 3
	"def test_example(): ...", // 4
	"", // 5
	"# mdq: [+3] Handles the empty list", // 6
	"# mdq: > Check the empty list.", // 7
	"def test_empty(): ...", // 8
	"", // 9
	"# mdq: [+1] Handles the secret input", // 10
	"def test_secret_dungeon(): ...", // 11
].join("\n");

type Verdict = "pass" | "fail";

function report(example: Verdict, empty: Verdict, secret: Verdict) {
	return {
		status: "completed",
		cases: [
			{ source: 0, line: 4, verdict: example, id: "test_example" },
			{ source: 0, line: 8, verdict: empty, id: "test_empty" },
			{ source: 0, line: 11, verdict: secret, id: "test_secret_dungeon" },
		],
	};
}

const GRADED = report("pass", "pass", "fail"); // 3/4
const PRETEST_FAILED = report("fail", "pass", "pass");
const RUNNER_ERROR = { status: "runner-error", cases: [], message: "boom" };

type Meta = Record<string, unknown>;

/// Pushes a published code question to `course`, with the given `meta`.
async function pushCode(course: CourseId, meta: Meta = {}) {
	const slug = tag("code-");
	await db.question.create(
		{
			course,
			slug,
			status: "PUBLISHED",
			version: "v1",
			rev: null,
			question: code({
				id: slug,
				title: "Sum",
				stem: "Write it.",
				language: "python",
				meta: { worker: "py-test", ...meta },
				tests: [{ format: "pytest", text: SOURCE }],
				answerKey: "def add(a, b): return a + b",
			}),
		},
		FULL_ACCESS,
	);
	return slug;
}

/// A course with its instructor, an enrolled student, a code question, an exam and the student's response.
async function world(
	opts: { meta?: Meta; examType?: "EXAM" | "QUIZ" | "PRACTICE" } = {},
) {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course.id);
	const question = await pushCode(course.id, opts.meta);
	const exam = await makeExam(course.id, {
		questions: [{ slug: question }],
		...(opts.examType ? { type: opts.examType } : {}),
	});
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	const [responseRow, questionRow] = await Promise.all([
		prisma.response.findUniqueOrThrow({
			where: { publicId: response.publicId },
		}),
		prisma.questionRef.findFirstOrThrow({
			where: { courseId: course.id, slug: question },
		}),
	]);
	return {
		course,
		instructor,
		student,
		question,
		questionId: questionRow.id,
		exam,
		response,
		responseId: responseRow.id,
		courseUrl: `${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}`,
	};
}

type World = Awaited<ReturnType<typeof world>>;
type JobState = "QUEUED" | "CLAIMED" | "DONE" | "FAILED" | "CANCELLED";

let tick = 0;

/// A `SUBMIT` submission and its grading job in `state`.
async function enqueue(
	w: World,
	fields: {
		state?: JobState;
		kind?: "SUBMIT" | "FINAL";
		payload?: string;
		claimedBy?: string;
		leaseUntil?: Date;
		attempts?: number;
		lastError?: string;
		status?: "PENDING_GRADE" | "PRETEST_FAILED";
		worker?: string;
	} = {},
) {
	const publicId = tag("sub");
	const submission = await prisma.submission.create({
		data: {
			publicId,
			responseId: w.responseId,
			questionId: w.questionId,
			payload: fields.payload ?? "def add(a, b): return a + b",
			kind: fields.kind ?? "SUBMIT",
			status: fields.status ?? "PENDING_GRADE",
			// Strictly increasing, so "oldest first" is unambiguous.
			createdAt: new Date(Date.now() - 1_000_000 + ++tick * 1000),
		},
	});
	await prisma.gradingJob.create({
		data: {
			submissionId: submission.id,
			worker: fields.worker ?? "py-test",
			state: fields.state ?? "QUEUED",
			claimedBy: fields.claimedBy ?? null,
			leaseUntil: fields.leaseUntil ?? null,
			attempts: fields.attempts ?? 0,
			lastError: fields.lastError ?? null,
		},
	});
	return publicId;
}

const jobOf = (publicId: string) =>
	prisma.gradingJob.findFirstOrThrow({
		where: { submission: { publicId } },
		include: { submission: true },
	});

/// The actor of a BOT key owned by `owner`, named `bot`.
const botOf = (
	owner: Pick<User, "username" | "name" | "role">,
	bot = "runner",
) => ({
	actor: { ...actorOf(owner).actor, bot } satisfies UserActor,
});

const ALL = { workers: ["py-test"] };

/// Errors that carry an HTTP status.
async function statusOf(promise: Promise<unknown>): Promise<number | string> {
	return promise.then(
		() => "resolved",
		(error: { status?: number }) => error.status ?? "no-status",
	);
}

//
// claim
//

test("claim: returns the job in the wire format and holds it for the bot", async () => {
	const w = await world();
	const sub = await enqueue(w, { payload: "module Main" });
	const before = Date.now();

	const jobs = await db.gradingJob.claim(
		{ ...ALL, leaseMs: 60_000 },
		botOf(w.instructor, "runner-a"),
	);

	expect(jobs).toHaveLength(1);
	const job = jobs[0];
	expect(job).toEqual({
		submission: sub,
		kind: "SUBMIT",
		worker: "py-test",
		question: expect.objectContaining({
			type: "code",
			language: "python",
			answerKey: "def add(a, b): return a + b",
			tests: [expect.objectContaining({ format: "pytest", text: SOURCE })],
		}),
		exam: w.exam.slug,
		course: w.courseUrl,
		student: w.student.username,
		answer: "module Main",
		leaseUntil: expect.any(String),
	});
	const lease = new Date(job?.leaseUntil ?? "").getTime();
	expect(lease).toBeGreaterThanOrEqual(before + 60_000);
	expect(lease).toBeLessThanOrEqual(Date.now() + 60_000);

	const row = await jobOf(sub);
	expect(row).toMatchObject({ state: "CLAIMED", claimedBy: "runner-a" });
	expect(row.leaseUntil?.toISOString()).toBe(job?.leaseUntil);
});

test("claim: the default limit is 4 and the oldest jobs go first", async () => {
	const w = await world();
	const subs: string[] = [];
	for (let i = 0; i < 6; i++) subs.push(await enqueue(w));

	const jobs = await db.gradingJob.claim(ALL, botOf(w.instructor));

	expect(jobs.map((j) => j.submission)).toEqual(subs.slice(0, 4));
	expect((await jobOf(subs[4] as string)).state).toBe("QUEUED");
});

test("claim: limit takes fewer, and must be between 1 and 20", async () => {
	const w = await world();
	await enqueue(w);
	await enqueue(w);

	const one = await db.gradingJob.claim(
		{ ...ALL, limit: 1 },
		botOf(w.instructor),
	);
	expect(one).toHaveLength(1);

	for (const limit of [0, 21]) {
		await expect(
			db.gradingJob.claim({ ...ALL, limit }, botOf(w.instructor)),
		).rejects.toBeInstanceOf(InvalidData);
	}
});

test("claim: a lease above 600 s is refused", async () => {
	const w = await world();
	await expect(
		db.gradingJob.claim({ ...ALL, leaseMs: 600_001 }, botOf(w.instructor)),
	).rejects.toBeInstanceOf(InvalidData);
});

test("claim: only jobs of the listed workers", async () => {
	const w = await world();
	const mine = await enqueue(w, { worker: "py-test" });
	const other = await enqueue(w, { worker: "elm-test" });

	const jobs = await db.gradingJob.claim(
		{ workers: ["py-test"] },
		botOf(w.instructor),
	);

	expect(jobs.map((j) => j.submission)).toEqual([mine]);
	expect((await jobOf(other)).state).toBe("QUEUED");
});

test("claim: only courses the key's owner teaches", async () => {
	const mine = await world();
	const theirs = await world();
	const a = await enqueue(mine);
	const b = await enqueue(theirs);

	const jobs = await db.gradingJob.claim(ALL, botOf(mine.instructor));

	expect(jobs.map((j) => j.submission)).toEqual([a]);
	expect((await jobOf(b)).state).toBe("QUEUED");
});

test("claim: course, exam, question and discipline narrow the jobs", async () => {
	const w = await world();
	const second = await makeExam(w.course.id, {
		questions: [{ slug: w.question }],
	});
	const otherQuestion = await pushCode(w.course.id);
	await prisma.questionsForExam.create({
		data: {
			examId: (
				await prisma.exam.findFirstOrThrow({
					where: { courseId: w.course.id, slug: w.exam.slug },
				})
			).id,
			questionRefId: (
				await prisma.questionRef.findFirstOrThrow({
					where: { courseId: w.course.id, slug: otherQuestion },
				})
			).id,
			position: 1,
		},
	});
	const secondResponse = await persistedResponseFactory.create({
		course: w.course.id,
		exam: second.slug,
		author: w.student.username,
	});
	const secondRow = await prisma.response.findUniqueOrThrow({
		where: { publicId: secondResponse.publicId },
	});
	const bot = botOf(w.instructor);
	const inFirst = await enqueue(w);
	const inSecond = await enqueue({ ...w, responseId: secondRow.id });
	const otherQ = await enqueue({
		...w,
		questionId: (
			await prisma.questionRef.findFirstOrThrow({
				where: { courseId: w.course.id, slug: otherQuestion },
			})
		).id,
	});
	const claim = async (filter: Record<string, unknown>) => {
		const jobs = await db.gradingJob.claim({ ...ALL, ...filter }, bot);
		// Put them back so the next filter sees the same queue.
		await prisma.gradingJob.updateMany({
			where: {
				submission: { publicId: { in: jobs.map((j) => j.submission) } },
			},
			data: { state: "QUEUED", claimedBy: null, leaseUntil: null },
		});
		return jobs.map((j) => j.submission).sort();
	};
	const sorted = (...ids: string[]) => ids.sort();

	expect(await claim({ course: w.courseUrl })).toEqual(
		sorted(inFirst, inSecond, otherQ),
	);
	expect(await claim({ course: "nope/nobody_2000-1" })).toEqual([]);
	expect(await claim({ exam: second.slug })).toEqual([inSecond]);
	expect(await claim({ exam: w.exam.slug })).toEqual(sorted(inFirst, otherQ));
	expect(await claim({ questions: [otherQuestion] })).toEqual([otherQ]);
	expect(await claim({ exam: w.exam.slug, questions: [w.question] })).toEqual([
		inFirst,
	]);
	expect(await claim({ discipline: w.course.discipline.slug })).toEqual(
		sorted(inFirst, inSecond, otherQ),
	);
	expect(await claim({ discipline: "no-such-discipline" })).toEqual([]);
});

test("claim: gives back jobs whose lease ran out, and keeps live ones", async () => {
	const w = await world();
	const expired = await enqueue(w, {
		state: "CLAIMED",
		claimedBy: "dead-bot",
		leaseUntil: new Date(Date.now() - 1000),
	});
	const live = await enqueue(w, {
		state: "CLAIMED",
		claimedBy: "other-bot",
		leaseUntil: new Date(Date.now() + 60_000),
	});

	const jobs = await db.gradingJob.claim(ALL, botOf(w.instructor, "me"));

	expect(jobs.map((j) => j.submission)).toEqual([expired]);
	expect(await jobOf(expired)).toMatchObject({
		state: "CLAIMED",
		claimedBy: "me",
	});
	expect(await jobOf(live)).toMatchObject({
		state: "CLAIMED",
		claimedBy: "other-bot",
	});
});

test("claim: an expired lease returns to the queue even when nothing matches the filters", async () => {
	const w = await world();
	const expired = await enqueue(w, {
		state: "CLAIMED",
		claimedBy: "dead-bot",
		leaseUntil: new Date(Date.now() - 1000),
		worker: "elm-test",
	});

	const jobs = await db.gradingJob.claim(ALL, botOf(w.instructor));

	expect(jobs).toEqual([]);
	expect(await jobOf(expired)).toMatchObject({
		state: "QUEUED",
		claimedBy: null,
		leaseUntil: null,
	});
});

test("claim: cancelled, done and failed jobs are never taken", async () => {
	const w = await world();
	for (const state of ["CANCELLED", "DONE", "FAILED"] as const) {
		await enqueue(w, { state });
	}

	expect(await db.gradingJob.claim(ALL, botOf(w.instructor))).toEqual([]);
});

test("claim: two concurrent claims never take the same job", async () => {
	const w = await world();
	for (let i = 0; i < 8; i++) await enqueue(w);

	const [a, b] = await Promise.all([
		db.gradingJob.claim({ ...ALL, limit: 8 }, botOf(w.instructor, "bot-a")),
		db.gradingJob.claim({ ...ALL, limit: 8 }, botOf(w.instructor, "bot-b")),
	]);

	const ids = [...a, ...b].map((j) => j.submission);
	expect(new Set(ids).size).toBe(ids.length);
	expect(ids).toHaveLength(8);
});

test("claim: refused to a session, a CLI key and SYSTEM", async () => {
	const w = await world();
	await enqueue(w);

	for (const opts of [actorOf(w.instructor), FULL_ACCESS]) {
		await expect(db.gradingJob.claim(ALL, opts)).rejects.toBeInstanceOf(
			NotAllowed,
		);
	}
});

//
// renew
//

test("renew: the holder extends the lease", async () => {
	const w = await world();
	const sub = await enqueue(w);
	const bot = botOf(w.instructor, "runner-a");
	await db.gradingJob.claim({ ...ALL, leaseMs: 10_000 }, bot);

	const { leaseUntil } = await db.gradingJob.renew(
		sub,
		{ leaseMs: 300_000 },
		bot,
	);

	expect(new Date(leaseUntil).getTime()).toBeGreaterThan(Date.now() + 290_000);
	expect((await jobOf(sub)).leaseUntil?.toISOString()).toBe(leaseUntil);
});

test("renew, fail and complete: 409 for a bot that does not hold the lease", async () => {
	const w = await world();
	const sub = await enqueue(w);
	await db.gradingJob.claim(ALL, botOf(w.instructor, "holder"));
	const intruder = botOf(w.instructor, "intruder");

	expect(
		await statusOf(db.gradingJob.renew(sub, { leaseMs: 1000 }, intruder)),
	).toBe(409);
	expect(
		await statusOf(
			db.gradingJob.fail(sub, { error: "x", retry: true }, intruder),
		),
	).toBe(409);
	expect(await statusOf(db.gradingJob.complete(sub, GRADED, intruder))).toBe(
		409,
	);
	expect(await jobOf(sub)).toMatchObject({
		state: "CLAIMED",
		claimedBy: "holder",
	});
});

test("renew, fail and complete: 409 on jobs that are queued, cancelled, done or failed", async () => {
	const w = await world();
	const bot = botOf(w.instructor, "runner");
	for (const state of ["QUEUED", "CANCELLED", "DONE", "FAILED"] as const) {
		const sub = await enqueue(w, { state, claimedBy: "runner" });
		expect(
			await statusOf(db.gradingJob.renew(sub, { leaseMs: 1000 }, bot)),
			state,
		).toBe(409);
		expect(
			await statusOf(db.gradingJob.fail(sub, { error: "x", retry: true }, bot)),
			state,
		).toBe(409);
		expect(
			await statusOf(db.gradingJob.complete(sub, GRADED, bot)),
			state,
		).toBe(409);
	}
});

test("renew, fail and complete: an unknown submission is not found, and a user is refused", async () => {
	const w = await world();
	const sub = await enqueue(w);

	await expect(
		db.gradingJob.renew("nope", { leaseMs: 1000 }, botOf(w.instructor)),
	).rejects.toBeInstanceOf(NotFound);
	await expect(
		db.gradingJob.renew(sub, { leaseMs: 1000 }, actorOf(w.instructor)),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.gradingJob.complete(sub, GRADED, actorOf(w.instructor)),
	).rejects.toBeInstanceOf(NotAllowed);
});

test("renew: a bot of another course owner cannot touch the job", async () => {
	const w = await world();
	const sub = await enqueue(w);
	await db.gradingJob.claim(ALL, botOf(w.instructor, "runner"));
	const stranger = (await makeCourse()).instructor;

	expect(
		await statusOf(
			db.gradingJob.renew(sub, { leaseMs: 1000 }, botOf(stranger, "runner")),
		),
	).toBeGreaterThanOrEqual(403);
});

//
// fail
//

async function claimed(w: World, bot = "runner") {
	const sub = await enqueue(w);
	await db.gradingJob.claim({ ...ALL, limit: 1 }, botOf(w.instructor, bot));
	return sub;
}

test("fail with retry: counts the attempt, keeps the error and requeues", async () => {
	const w = await world();
	const sub = await claimed(w);

	const result = await db.gradingJob.fail(
		sub,
		{ error: "sandbox died", retry: true },
		botOf(w.instructor),
	);

	expect(result).toEqual({ state: "QUEUED" });
	expect(await jobOf(sub)).toMatchObject({
		state: "QUEUED",
		attempts: 1,
		lastError: "sandbox died",
		claimedBy: null,
		leaseUntil: null,
	});
});

test("fail with retry: the third failure is final", async () => {
	const w = await world();
	const sub = await enqueue(w);
	const bot = botOf(w.instructor);
	const states: string[] = [];
	for (let i = 0; i < 3; i++) {
		await db.gradingJob.claim({ ...ALL, limit: 1 }, bot);
		const { state } = await db.gradingJob.fail(
			sub,
			{ error: `try ${i}`, retry: true },
			bot,
		);
		states.push(state);
	}

	expect(states).toEqual(["QUEUED", "QUEUED", "FAILED"]);
	expect(await jobOf(sub)).toMatchObject({
		state: "FAILED",
		attempts: 3,
		lastError: "try 2",
	});
	expect(await db.gradingJob.claim(ALL, bot)).toEqual([]);
});

test("fail without retry: gives the job back and does not count", async () => {
	const w = await world();
	const sub = await claimed(w);

	const result = await db.gradingJob.fail(
		sub,
		{ error: "shutting down", retry: false },
		botOf(w.instructor),
	);

	expect(result).toEqual({ state: "QUEUED" });
	expect(await jobOf(sub)).toMatchObject({
		state: "QUEUED",
		attempts: 0,
		claimedBy: null,
		leaseUntil: null,
	});
});

//
// complete
//

test("complete: a graded report writes the bot's pass and closes the job", async () => {
	const w = await world();
	const sub = await claimed(w, "runner-a");

	const result = await db.gradingJob.complete(
		sub,
		GRADED,
		botOf(w.instructor, "runner-a"),
	);

	expect(result).toEqual({
		state: "DONE",
		status: "GRADED_AUTOMATICALLY",
		score: 0.75,
	});
	const row = await jobOf(sub);
	expect(row.state).toBe("DONE");
	expect(row.submission.status).toBe("GRADED_AUTOMATICALLY");
	expect(row.submission.runnerReport).toEqual(GRADED);
	const passes = await prisma.feedback.findMany({
		where: { submissionId: row.submissionId },
	});
	expect(passes).toHaveLength(1);
	expect(passes[0]).toMatchObject({
		ref: "runner-a",
		botId: "runner-a",
		graderId: null,
		score: "0.75",
	});
	expect(passes[0]?.feedback).toContain("✓ Runs the example");
	expect(passes[0]?.feedback).toContain("✗ Handles the secret input");
});

test("complete: a failed pretest returns the submission at no cost", async () => {
	const w = await world();
	const sub = await claimed(w);

	const result = await db.gradingJob.complete(
		sub,
		PRETEST_FAILED,
		botOf(w.instructor),
	);

	expect(result).toEqual({ state: "DONE", status: "PRETEST_FAILED" });
	const row = await jobOf(sub);
	expect(row.state).toBe("DONE");
	expect(row.submission.status).toBe("PRETEST_FAILED");
	expect(row.submission.runnerReport).toEqual(PRETEST_FAILED);
	expect(
		await prisma.feedback.count({ where: { submissionId: row.submissionId } }),
	).toBe(0);
});

test("complete: a build error is a failed pretest", async () => {
	const w = await world();
	const sub = await claimed(w);

	const result = await db.gradingJob.complete(
		sub,
		{ status: "build-error", cases: [], build: "SyntaxError" },
		botOf(w.instructor),
	);

	expect(result).toMatchObject({ state: "DONE", status: "PRETEST_FAILED" });
});

test("complete: a runner-error report is an infrastructure failure with a retry", async () => {
	const w = await world();
	const sub = await claimed(w);

	const result = await db.gradingJob.complete(
		sub,
		RUNNER_ERROR,
		botOf(w.instructor),
	);

	expect(result).toEqual({ state: "QUEUED", status: "PENDING_GRADE" });
	const row = await jobOf(sub);
	expect(row).toMatchObject({
		state: "QUEUED",
		attempts: 1,
		lastError: "boom",
		claimedBy: null,
	});
	expect(row.submission.runnerReport).toEqual(RUNNER_ERROR);
});

test("complete: an invalid report is a 400 and leaves the job held", async () => {
	const w = await world();
	const sub = await claimed(w, "runner");

	await expect(
		db.gradingJob.complete(
			sub,
			{ status: "completed", cases: [{ nonsense: true }] },
			botOf(w.instructor, "runner"),
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(await jobOf(sub)).toMatchObject({
		state: "CLAIMED",
		claimedBy: "runner",
	});
});

test("complete: a second report for a done job is a 409", async () => {
	const w = await world();
	const sub = await claimed(w);
	const bot = botOf(w.instructor);
	await db.gradingJob.complete(sub, GRADED, bot);

	expect(await statusOf(db.gradingJob.complete(sub, GRADED, bot))).toBe(409);
	expect(
		await prisma.feedback.count({ where: { submission: { publicId: sub } } }),
	).toBe(1);
});

test("complete: a lease that ran out but was not taken over still accepts the result", async () => {
	const w = await world();
	const sub = await enqueue(w, {
		state: "CLAIMED",
		claimedBy: "runner",
		leaseUntil: new Date(Date.now() - 5000),
	});

	const result = await db.gradingJob.complete(
		sub,
		GRADED,
		botOf(w.instructor, "runner"),
	);

	expect(result.state).toBe("DONE");
});

test("complete: after another bot took the job over, the late bot gets 409", async () => {
	const w = await world();
	const sub = await enqueue(w, {
		state: "CLAIMED",
		claimedBy: "slow",
		leaseUntil: new Date(Date.now() - 5000),
	});
	await db.gradingJob.claim(ALL, botOf(w.instructor, "fast"));

	expect(
		await statusOf(
			db.gradingJob.complete(sub, GRADED, botOf(w.instructor, "slow")),
		),
	).toBe(409);
	expect((await jobOf(sub)).claimedBy).toBe("fast");
});

//
// A human grade closes the job
//

test("a human pass on a queued or claimed job closes it, and the worker's report is a 409", async () => {
	const w = await world();
	const queued = await enqueue(w);
	const held = await claimed(w, "runner");
	const bot = botOf(w.instructor, "runner");
	const human = actorOf(w.instructor);

	for (const sub of [queued, held]) {
		await db.feedback.create(
			{ submission: { publicId: sub }, ref: "prof", score: "1" },
			human,
		);
		expect((await jobOf(sub)).state).toBe("DONE");
		expect(await statusOf(db.gradingJob.complete(sub, GRADED, bot))).toBe(409);
	}
	expect(
		await prisma.feedback.count({ where: { submission: { publicId: held } } }),
	).toBe(1);
});

test("upsert of a new human pass closes the job too", async () => {
	const w = await world();
	const sub = await enqueue(w);

	await db.feedback.upsert(
		{ submission: { publicId: sub }, ref: "prof", score: "1/2" },
		actorOf(w.instructor),
	);

	expect((await jobOf(sub)).state).toBe("DONE");
});

test("a human pass leaves failed and cancelled jobs as they are", async () => {
	const w = await world();
	const failed = await enqueue(w, { state: "FAILED" });
	const cancelled = await enqueue(w, { state: "CANCELLED" });

	for (const sub of [failed, cancelled]) {
		await db.feedback.create(
			{ submission: { publicId: sub }, ref: "prof", score: "1" },
			actorOf(w.instructor),
		);
	}

	expect((await jobOf(failed)).state).toBe("FAILED");
	expect((await jobOf(cancelled)).state).toBe("CANCELLED");
});

//
// requeueFailed and summary
//

test("requeueFailed: failed jobs of the question go back to the queue with a clean count", async () => {
	const w = await world();
	const failed = await enqueue(w, {
		state: "FAILED",
		attempts: 3,
		lastError: "no sandbox",
	});
	const done = await enqueue(w, { state: "DONE" });
	const other = await world();
	const otherFailed = await enqueue(other, { state: "FAILED", attempts: 3 });

	const result = await db.gradingJob.requeueFailed(
		{ course: w.course.id, exam: w.exam.slug, question: w.question },
		actorOf(w.instructor),
	);

	expect(result).toEqual({ requeued: 1 });
	expect(await jobOf(failed)).toMatchObject({
		state: "QUEUED",
		attempts: 0,
		lastError: null,
	});
	expect((await jobOf(done)).state).toBe("DONE");
	expect((await jobOf(otherFailed)).state).toBe("FAILED");
});

test("requeueFailed and summary: only the course's instructor", async () => {
	const w = await world();
	await enqueue(w, { state: "FAILED" });
	const stranger = (await makeCourse()).instructor;
	const input = {
		course: w.course.id,
		exam: w.exam.slug,
		question: w.question,
	};

	for (const actor of [actorOf(stranger), actorOf(w.student)]) {
		await expect(
			db.gradingJob.requeueFailed(input, actor),
		).rejects.toBeInstanceOf(NotAllowed);
		await expect(db.gradingJob.summary(input, actor)).rejects.toBeInstanceOf(
			NotAllowed,
		);
	}
});

test("summary: counts by state, lists the failures and shows when the bot keys were last used", async () => {
	const w = await world();
	await enqueue(w);
	await enqueue(w);
	await enqueue(w, {
		state: "CLAIMED",
		claimedBy: "r",
		leaseUntil: new Date(),
	});
	await enqueue(w, { state: "DONE" });
	const failed = await enqueue(w, {
		state: "FAILED",
		attempts: 3,
		lastError: "sandbox exploded",
	});
	const seen = new Date("2026-11-12T10:00:00Z");
	const key = (
		name: string,
		kind: "BOT" | "CLI",
		owner: string,
		usedAt: Date | null,
	) =>
		prisma.apiKey.create({
			data: {
				publicId: tag("k"),
				keyHash: tag("h"),
				name,
				kind,
				createdById: owner,
				lastUsedAt: usedAt,
			},
		});
	await key("runner-seen", "BOT", w.instructor.username, seen);
	await key("runner-new", "BOT", w.instructor.username, null);
	await key("my-cli", "CLI", w.instructor.username, seen);
	const stranger = (await makeCourse()).instructor;
	await key("not-mine", "BOT", stranger.username, seen);

	const summary = await db.gradingJob.summary(
		{ course: w.course.id, exam: w.exam.slug, question: w.question },
		actorOf(w.instructor),
	);

	expect(summary.counts).toEqual({
		QUEUED: 2,
		CLAIMED: 1,
		DONE: 1,
		FAILED: 1,
		CANCELLED: 0,
	});
	expect(summary.failures).toEqual([
		{
			submission: failed,
			student: w.student.username,
			attempts: 3,
			lastError: "sandbox exploded",
		},
	]);
	expect(
		[...summary.keys].sort((a, b) => a.name.localeCompare(b.name)),
	).toEqual([
		{ name: "runner-new", lastUsedAt: null },
		{ name: "runner-seen", lastUsedAt: seen },
	]);
});

//
// forStudent
//

async function sentBy(
	w: World,
	state: JobState,
	report?: unknown,
	status?: "PENDING_GRADE" | "PRETEST_FAILED",
) {
	const sub = await enqueue(w, { state, status });
	if (report !== undefined) {
		await prisma.submission.update({
			where: { publicId: sub },
			data: { runnerReport: report as never },
		});
	}
	return sub;
}

const asStudent = (w: World) => actorOf(w.student);
const lookup = (w: World) => ({
	response: w.response.publicId,
	question: w.question,
});

test("forStudent: lists the sent submissions with their state, not the autosaves", async () => {
	const w = await world({ meta: { attempts: 3 } });
	const queued = await sentBy(w, "QUEUED");
	const final = await enqueue(w, { state: "CLAIMED", kind: "FINAL" });
	await prisma.submission.create({
		data: {
			publicId: tag("auto"),
			responseId: w.responseId,
			questionId: w.questionId,
			payload: "draft",
			kind: "AUTOSAVE",
		},
	});

	const view = await db.gradingJob.forStudent(lookup(w), asStudent(w));

	expect(view.attempts).toBe(3);
	expect(view.submissions).toEqual([
		expect.objectContaining({
			submission: queued,
			kind: "SUBMIT",
			jobState: "QUEUED",
			status: "PENDING_GRADE",
			createdAt: expect.any(Date),
		}),
		expect.objectContaining({
			submission: final,
			kind: "FINAL",
			jobState: "CLAIMED",
		}),
	]);
	expect(view.submissions[0]).not.toHaveProperty("report");
});

test("forStudent: attempts left count only done submissions that were not a failed pretest", async () => {
	const w = await world({ meta: { attempts: 4 } });
	await sentBy(w, "DONE", GRADED);
	await sentBy(w, "DONE", PRETEST_FAILED, "PRETEST_FAILED");
	await sentBy(w, "QUEUED");
	await sentBy(w, "CANCELLED");

	const view = await db.gradingJob.forStudent(lookup(w), asStudent(w));

	expect(view.attemptsLeft).toBe(3);
});

test("forStudent: attempts default to 4, and a practice exam has no limit", async () => {
	const defaults = await world();
	expect(
		await db.gradingJob.forStudent(lookup(defaults), asStudent(defaults)),
	).toMatchObject({ attempts: 4, attemptsLeft: 4 });

	const practice = await world({ examType: "PRACTICE" });
	await sentBy(practice, "DONE", GRADED);
	expect(
		await db.gradingJob.forStudent(lookup(practice), asStudent(practice)),
	).toMatchObject({ attemptsLeft: null });
});

test("forStudent: a done submission carries the report view, with the score when it may be seen", async () => {
	const w = await world({ meta: { attempts: 3 } });
	await sentBy(w, "DONE", GRADED);

	const view = await db.gradingJob.forStudent(lookup(w), asStudent(w));

	const shown = view.submissions[0]?.report;
	expect(shown).toMatchObject({ outcome: "graded", score: 0.75 });
	expect(shown?.publicCases).toHaveLength(1);
	expect(JSON.stringify(shown)).not.toContain("test_secret_dungeon");
});

test("forStudent: with a single attempt in an exam, the score waits for the release", async () => {
	const w = await world({ meta: { attempts: 1 } });
	await sentBy(w, "DONE", GRADED);

	const view = await db.gradingJob.forStudent(lookup(w), asStudent(w));

	const shown = view.submissions[0]?.report;
	expect(shown?.outcome).toBe("graded");
	expect(shown).not.toHaveProperty("score");
	expect(shown).not.toHaveProperty("items");
	expect(shown?.publicCases).toHaveLength(1);
});

test("forStudent: a student sees only their own submissions", async () => {
	const w = await world();
	await sentBy(w, "QUEUED");
	const classmate = await enroll(w.course.id);

	await expect(
		db.gradingJob.forStudent(lookup(w), actorOf(classmate)),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.gradingJob.forStudent(
			{ response: "missing", question: w.question },
			asStudent(w),
		),
	).rejects.toBeInstanceOf(NotFound);
});
