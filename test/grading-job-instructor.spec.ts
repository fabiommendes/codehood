import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { NotAllowed, NotFound } from "@/core/error";
import type { CourseId } from "@/core/schemas";
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

// The instructor's batch read of the sent submissions of a code question.

async function world(opts: { type?: "EXAM" | "PRACTICE" } = {}) {
	const { course, instructor } = await makeCourse();
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
	const exam = await makeExam(course.id, {
		questions: [{ slug }],
		...(opts.type ? { type: opts.type } : {}),
	});
	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: course.id, slug },
	});

	/// A student with an attempt, and a way to add sent submissions to it.
	const attemptOf = async (courseId: CourseId = course.id) => {
		const student = await enroll(courseId);
		const response = await persistedResponseFactory.create({
			course: courseId,
			exam: exam.slug,
			author: student.username,
		});
		const row = await prisma.response.findUniqueOrThrow({
			where: { publicId: response.publicId },
		});
		let tick = 0;
		const send = async (
			fields: {
				kind?: "SUBMIT" | "FINAL";
				status?: "PENDING_GRADE" | "PRETEST_FAILED";
				score?: string;
				report?: object;
				lastError?: string;
			} = {},
		) => {
			const submission = await prisma.submission.create({
				data: {
					publicId: tag("sub"),
					responseId: row.id,
					questionId: ref.id,
					kind: fields.kind ?? "SUBMIT",
					status: fields.status ?? "PENDING_GRADE",
					payload: "code",
					createdAt: new Date(Date.now() - 100_000 + ++tick * 1000),
					...(fields.report ? { runnerReport: fields.report } : {}),
				},
			});
			await prisma.gradingJob.create({
				data: {
					submissionId: submission.id,
					worker: "elm-test",
					state: "DONE",
					lastError: fields.lastError ?? null,
				},
			});
			if (fields.score) {
				await prisma.feedback.create({
					data: {
						ref: "bot",
						botId: "bot",
						submissionId: submission.id,
						score: fields.score,
					},
				});
			}
			return submission.publicId;
		};
		return { student, response: response.publicId, send };
	};
	return { course, instructor, slug, attemptOf };
}

const read = (
	w: Awaited<ReturnType<typeof world>>,
	responses: string[],
	actor = actorOf(w.instructor),
) => db.gradingJob.forInstructor({ question: w.slug, responses }, actor);

test("reads two students in one call, with the discount and the counting submission", async () => {
	const w = await world();
	const a = await w.attemptOf();
	const hidden = { status: "completed", cases: [{ hidden: "yes" }] };
	const failed = await a.send({ status: "PRETEST_FAILED", lastError: "boom" });
	const first = await a.send({ score: "0.6", report: hidden });
	const second = await a.send({ kind: "FINAL", score: "1" });
	const b = await w.attemptOf();
	const lone = await b.send({ score: "1" });

	const view = await read(w, [a.response, b.response]);

	expect(Object.keys(view).sort()).toEqual([a.response, b.response].sort());
	const ours = view[a.response];
	expect(ours).toMatchObject({ attempts: 4, penalty: 0.2 });
	expect(ours?.submissions.map((s) => s.submission)).toEqual([
		failed,
		first,
		second,
	]);
	expect(ours?.submissions[0]).toMatchObject({
		kind: "SUBMIT",
		status: "PRETEST_FAILED",
		jobState: "DONE",
		lastError: "boom",
	});
	expect(ours?.submissions[0]).not.toHaveProperty("counts");
	expect(ours?.submissions[1]).toMatchObject({
		score: 0.6,
		discounted: 0.6,
		counts: false,
		report: hidden,
	});
	expect(ours?.submissions[2]).toMatchObject({
		kind: "FINAL",
		score: 1,
		discounted: 0.8,
		counts: true,
	});
	expect(view[b.response]?.submissions).toEqual([
		expect.objectContaining({ submission: lone, counts: true, discounted: 1 }),
	]);
});

test("a practice exam has no discount", async () => {
	const w = await world({ type: "PRACTICE" });
	const a = await w.attemptOf();
	await a.send({ score: "0.6" });
	await a.send({ score: "1" });

	const view = await read(w, [a.response]);

	expect(view[a.response]?.penalty).toBe(0);
	expect(view[a.response]?.submissions.map((s) => s.discounted)).toEqual([
		0.6, 1,
	]);
});

test("a student is refused", async () => {
	const w = await world();
	const a = await w.attemptOf();
	await a.send({ score: "1" });

	await expect(read(w, [a.response], actorOf(a.student))).rejects.toMatchObject(
		{ status: 403 },
	);
	await expect(
		read(w, [a.response], actorOf(a.student)),
	).rejects.toBeInstanceOf(NotAllowed);
});

test("an answer of a course the actor does not teach is refused", async () => {
	const w = await world();
	const other = await world();
	const mine = await w.attemptOf();
	const theirs = await other.attemptOf();

	await expect(
		read(w, [mine.response, theirs.response]),
	).rejects.toBeInstanceOf(NotAllowed);
});

test("an unknown answer is not found", async () => {
	const w = await world();
	const a = await w.attemptOf();

	await expect(read(w, [a.response, "nope"])).rejects.toBeInstanceOf(NotFound);
});

test("no answers, no rows", async () => {
	const w = await world();
	expect(await read(w, [])).toEqual({});
});
