import { expect, test } from "@playwright/test";
import { FULL_ACCESS, type UserActor } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { sumCode } from "@/mdq/fixtures";
import {
	actorOf,
	enroll,
	makeCourse,
	makeExam,
	tag,
} from "./conditional-write-exam-support";

// Claiming sends the last autosave of an attempt whose time ran out, so a
// student who never pressed "send" still gets graded.

const HOUR = 3_600_000;
const WORKERS = { workers: ["elm-test"] };

const botOf = (owner: Parameters<typeof actorOf>[0]) => ({
	actor: { ...actorOf(owner).actor, bot: "runner" } satisfies UserActor,
});

interface Opts {
	/// Start of the exam window, relative to now.
	startedMs?: number | null;
	/// Length of the exam window.
	durationMs?: number | null;
	type?: "EXAM" | "PRACTICE";
}

/// An attempt at an exam with one `code` question, by default ended an hour ago.
async function world({
	startedMs = -2 * HOUR,
	durationMs = HOUR,
	type = "EXAM",
}: Opts = {}) {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course.id);
	const slug = tag("code-");
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			rev: null,
			question: { ...sumCode, meta: { worker: "elm-test" } },
		},
		FULL_ACCESS,
	);
	const exam = await makeExam(course.id, { questions: [{ slug }], type });
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			scheduledAt: startedMs === null ? null : new Date(Date.now() + startedMs),
			durationMs,
		},
	});
	const row = await prisma.response.findUniqueOrThrow({
		where: { publicId: response.publicId },
	});
	const question = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: course.id, slug },
	});
	const add = (kind: "AUTOSAVE" | "SUBMIT" | "FINAL", payload: string) =>
		prisma.submission.create({
			data: {
				publicId: tag("sub"),
				responseId: row.id,
				questionId: question.id,
				kind,
				payload,
			},
		});
	return { instructor, student, exam, responseId: row.id, add };
}

type World = Awaited<ReturnType<typeof world>>;

const claim = (w: World) => db.gradingJob.claim(WORKERS, botOf(w.instructor));

const finals = (w: World) =>
	prisma.submission.count({
		where: { responseId: w.responseId, kind: "FINAL" },
	});

test("an expired attempt's last autosave is sent as FINAL and claimed at once", async () => {
	const w = await world();
	await w.add("AUTOSAVE", "first");
	await w.add("AUTOSAVE", "last");

	const jobs = await claim(w);

	expect(jobs).toHaveLength(1);
	expect(jobs[0]).toMatchObject({
		kind: "FINAL",
		answer: "last",
		student: w.student.username,
	});
	expect(await finals(w)).toBe(1);
});

test("a second claim does not send it again", async () => {
	const w = await world();
	await w.add("AUTOSAVE", "last");

	await claim(w);
	const again = await claim(w);

	expect(again).toEqual([]);
	expect(await finals(w)).toBe(1);
});

test("an attempt still open is left alone", async () => {
	const w = await world({ durationMs: 3 * HOUR });
	await w.add("AUTOSAVE", "typing");

	expect(await claim(w)).toEqual([]);
	expect(await finals(w)).toBe(0);
});

test("an attempt inside the grace window after the deadline is left alone", async () => {
	const w = await world({ startedMs: -HOUR - 2_000 });
	await w.add("AUTOSAVE", "typing");

	expect(await claim(w)).toEqual([]);
	expect(await finals(w)).toBe(0);
});

test("a student whose extra time has not run out is left alone", async () => {
	const w = await world();
	await prisma.examException.create({
		data: {
			examId: w.exam.id,
			username: w.student.username,
			extraTimeMs: 2 * HOUR,
		},
	});
	await w.add("AUTOSAVE", "typing");

	expect(await claim(w)).toEqual([]);
	expect(await finals(w)).toBe(0);
});

test("an untimed exam has no deadline and sends nothing", async () => {
	const w = await world({ startedMs: null, durationMs: null });
	await w.add("AUTOSAVE", "typing");

	expect(await claim(w)).toEqual([]);
	expect(await finals(w)).toBe(0);
});

test("a practice attempt is never sent", async () => {
	const w = await world({ type: "PRACTICE" });
	await w.add("AUTOSAVE", "typing");

	expect(await claim(w)).toEqual([]);
	expect(await finals(w)).toBe(0);
});

test("an autosave equal to the last send is not sent again", async () => {
	const w = await world();
	await w.add("SUBMIT", "same");
	await prisma.gradingJob.create({
		data: {
			submissionId: (
				await prisma.submission.findFirstOrThrow({
					where: { responseId: w.responseId },
				})
			).id,
			worker: "elm-test",
			state: "DONE",
		},
	});
	await w.add("AUTOSAVE", "same");

	expect(await claim(w)).toEqual([]);
	expect(await finals(w)).toBe(0);
});

test("an attempt with no sends left is not sent", async () => {
	const w = await world();
	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { questionsForExams: { some: { examId: w.exam.id } } },
	});
	await prisma.questionRef.update({
		where: { id: ref.id },
		data: { attempts: 1 },
	});
	const sent = await w.add("SUBMIT", "sent");
	await prisma.gradingJob.create({
		data: { submissionId: sent.id, worker: "elm-test", state: "DONE" },
	});
	await w.add("AUTOSAVE", "typed after");

	expect(await claim(w)).toEqual([]);
	expect(await finals(w)).toBe(0);
});

test("a course of another instructor is not touched", async () => {
	const w = await world();
	const other = await makeCourse();
	await w.add("AUTOSAVE", "last");

	expect(await claim({ ...w, instructor: other.instructor })).toEqual([]);
	expect(await finals(w)).toBe(0);

	expect(await claim(w)).toHaveLength(1);
});

test("an attempt of a worker that was not asked for is not sent", async () => {
	const w = await world();
	await w.add("AUTOSAVE", "last");

	const jobs = await db.gradingJob.claim(
		{ workers: ["py-test"] },
		botOf(w.instructor),
	);

	expect(jobs).toEqual([]);
	expect(await finals(w)).toBe(0);
});
