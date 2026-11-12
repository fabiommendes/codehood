import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { NotFound, PreconditionFailed } from "@/core/error";
import type { ExamExceptionId } from "@/core/schemas";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import {
	actorOf,
	at,
	enroll,
	makeAttempt,
	makeCourse,
	makeExam,
	makeQuestion,
	makeReport,
	makeResponse,
	STALE,
	tag,
} from "./conditional-write-exam-support";

/// ADR 0013 for exam, examException, response and report. Every fixture
/// creates its own rows under random keys.

/// Settles a promise to the `PreconditionFailed` it throws, or fails the test.
async function failure(promise: Promise<unknown>): Promise<PreconditionFailed> {
	const err = await promise.then(
		() => null,
		(e: unknown) => e,
	);
	expect(err).toBeInstanceOf(PreconditionFailed);
	return err as PreconditionFailed;
}

const ms = (date: Date) => date.getTime();

//
// Exam
//

test("exam.update: right version writes and bumps", async () => {
	const { course } = await makeCourse();
	const exam = await makeExam(course.id);
	const updated = await db.exam.update(
		{ id: exam.id },
		{ title: "New" },
		at(exam.updatedAt),
	);
	expect(updated.title).toBe("New");
	expect(ms(updated.updatedAt)).toBeGreaterThan(ms(exam.updatedAt));
});

test("exam.update: stale version throws with the current one and writes nothing, children included", async () => {
	const { course } = await makeCourse();
	const q1 = await makeQuestion(course.id);
	const q2 = await makeQuestion(course.id);
	const exam = await makeExam(course.id, {
		tags: ["a"],
		questions: [{ slug: q1.slug }],
	});
	const err = await failure(
		db.exam.update(
			{ id: exam.id },
			{ title: "New", tags: ["b", "c"], questions: [{ slug: q2.slug }] },
			at(STALE),
		),
	);
	expect(err.updatedAt).toEqual(exam.updatedAt);
	const after = await db.exam.findOne({ id: exam.id }, FULL_ACCESS);
	expect(after?.title).toBe(exam.title);
	expect(after?.tags).toEqual(["a"]);
	expect(after?.questions.map((q) => q.slug)).toEqual([q1.slug]);
	expect(after?.updatedAt).toEqual(exam.updatedAt);
});

test("exam.update: absent expectation writes", async () => {
	const { course } = await makeCourse();
	const exam = await makeExam(course.id);
	const updated = await db.exam.update(
		{ course: course.id, slug: exam.slug },
		{ title: "New" },
		FULL_ACCESS,
	);
	expect(updated.title).toBe("New");
});

test("exam.update: replacing only the tags or only the questions bumps the exam", async () => {
	const { course } = await makeCourse();
	const q = await makeQuestion(course.id);
	const exam = await makeExam(course.id, { tags: ["a"] });
	const tagged = await db.exam.update(
		{ id: exam.id },
		{ tags: ["b"] },
		at(exam.updatedAt),
	);
	expect(tagged.tags).toEqual(["b"]);
	expect(ms(tagged.updatedAt)).toBeGreaterThan(ms(exam.updatedAt));

	const pinned = await db.exam.update(
		{ id: exam.id },
		{ questions: [{ slug: q.slug }] },
		at(tagged.updatedAt),
	);
	expect(pinned.questions.map((x) => x.slug)).toEqual([q.slug]);
	expect(ms(pinned.updatedAt)).toBeGreaterThan(ms(tagged.updatedAt));
	// The old version is now stale for the next writer.
	await failure(
		db.exam.update({ id: exam.id }, { title: "x" }, at(tagged.updatedAt)),
	);
});

test("exam.update: a Date on a missing row is a 412 with null, a missing course stays NotFound", async () => {
	const { course } = await makeCourse();
	const missing = { course: course.id, slug: tag("nope-") };
	const err = await failure(
		db.exam.update(missing, { title: "x" }, at(new Date())),
	);
	expect(err.updatedAt).toBeNull();
	await failure(
		db.exam.update({ id: 2_000_000_000 as never }, {}, at(new Date())),
	);
	await expect(
		db.exam.update(
			{ course: 2_000_000_000 as never, slug: "nope" },
			{ title: "x" },
			at(new Date()),
		),
	).rejects.toBeInstanceOf(NotFound);
	// Without the option a missing exam is still a NotFound.
	await expect(
		db.exam.update(missing, { title: "x" }, FULL_ACCESS),
	).rejects.toBeInstanceOf(NotFound);
});

test("exam.upsert: null creates, then fails when it exists", async () => {
	const { course } = await makeCourse();
	const input = { course: course.id, slug: tag("exam-"), title: "T" };
	const created = await db.exam.upsert(input, at(null));
	expect(created.title).toBe("T");
	const err = await failure(db.exam.upsert(input, at(null)));
	expect(err.updatedAt).toEqual(created.updatedAt);
});

test("exam.upsert: Date updates when right, fails when stale or absent", async () => {
	const { course } = await makeCourse();
	const exam = await makeExam(course.id);
	const input = { course: course.id, slug: exam.slug, title: "Again" };
	await failure(db.exam.upsert(input, at(STALE)));
	expect((await db.exam.findOne({ id: exam.id }, FULL_ACCESS))?.title).toBe(
		exam.title,
	);
	const updated = await db.exam.upsert(input, at(exam.updatedAt));
	expect(updated.title).toBe("Again");
	const err = await failure(
		db.exam.upsert({ ...input, slug: tag("none-") }, at(new Date())),
	);
	expect(err.updatedAt).toBeNull();
});

test("exam.delete: right version archives, stale throws and keeps it", async () => {
	const { course } = await makeCourse();
	const exam = await makeExam(course.id);
	await failure(db.exam.delete({ id: exam.id }, at(STALE)));
	expect((await db.exam.findOne({ id: exam.id }, FULL_ACCESS))?.status).toBe(
		exam.status,
	);
	await db.exam.delete({ id: exam.id }, at(exam.updatedAt));
	const archived = await db.exam.findOne({ id: exam.id }, FULL_ACCESS);
	expect(archived?.status).toBe("ARCHIVED");
	// Archiving again is a no-op, but a stale caller is still refused.
	await failure(db.exam.delete({ id: exam.id }, at(STALE)));
});

test("exam.delete: a Date on a missing row is a 412 with null, none is a NotFound", async () => {
	const { course } = await makeCourse();
	const missing = { course: course.id, slug: tag("nope-") };
	const err = await failure(db.exam.delete(missing, at(new Date())));
	expect(err.updatedAt).toBeNull();
	await expect(db.exam.delete(missing, FULL_ACCESS)).rejects.toBeInstanceOf(
		NotFound,
	);
});

test("exam.setAnswerHistory: no expectation flips it and bumps; one that is given is honored", async () => {
	const { course } = await makeCourse();
	const exam = await makeExam(course.id);
	const flipped = await db.exam.setAnswerHistory(
		{ id: exam.id },
		true,
		FULL_ACCESS,
	);
	expect(flipped.answerHistory).toBe(true);
	expect(ms(flipped.updatedAt)).toBeGreaterThan(ms(exam.updatedAt));
	await failure(db.exam.setAnswerHistory({ id: exam.id }, false, at(STALE)));
	expect(
		(await db.exam.findOne({ id: exam.id }, FULL_ACCESS))?.answerHistory,
	).toBe(true);
});

test("exam.releaseGrades: stale throws, even when the exam is already released", async () => {
	const { course } = await makeCourse();
	const exam = await makeExam(course.id, { status: "COMPLETED" });
	await failure(db.exam.releaseGrades({ id: exam.id }, at(STALE)));
	const released = await db.exam.releaseGrades(
		{ id: exam.id },
		at(exam.updatedAt),
	);
	expect(released.gradesReleasedAt).not.toBeNull();
	expect(ms(released.updatedAt)).toBeGreaterThan(ms(exam.updatedAt));
	await failure(db.exam.releaseGrades({ id: exam.id }, at(STALE)));
	const again = await db.exam.releaseGrades(
		{ id: exam.id },
		at(released.updatedAt),
	);
	expect(again.updatedAt).toEqual(released.updatedAt);
});

//
// ExamException
//

/// The instructor's note, which the public read model leaves out.
async function noteOf(id: ExamExceptionId) {
	return (await prisma.examException.findUniqueOrThrow({ where: { id } })).note;
}

async function makeException() {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course.id);
	const exam = await makeExam(course.id, { duration: { minutes: 60 } });
	const key = {
		course: course.id,
		exam: exam.slug,
		username: student.username,
	};
	const exception = await db.examException.create(
		{ ...key, extraTime: { minutes: 10 } },
		FULL_ACCESS,
	);
	return { course, instructor, student, exam, key, exception };
}

test("examException.update: right version writes and bumps, stale throws and writes nothing", async () => {
	const { key, exception } = await makeException();
	const err = await failure(
		db.examException.update(key, { note: "x" }, at(STALE)),
	);
	expect(err.updatedAt).toEqual(exception.updatedAt);
	expect(await noteOf(exception.id)).toBeNull();
	const updated = await db.examException.update(
		key,
		{ note: "x" },
		at(exception.updatedAt),
	);
	expect(updated.note).toBe("x");
	expect(ms(updated.updatedAt)).toBeGreaterThan(ms(exception.updatedAt));
});

test("examException.update: absent expectation writes", async () => {
	const { key } = await makeException();
	const updated = await db.examException.update(
		key,
		{ note: "y" },
		FULL_ACCESS,
	);
	expect(updated.note).toBe("y");
});

test("examException.update and delete: a Date on a missing row is a 412 with null, a missing exam stays NotFound", async () => {
	const { key, course, instructor } = await makeException();
	const other = await enroll(course.id);
	const missing = { ...key, username: other.username };
	const err = await failure(
		db.examException.update(missing, { note: "x" }, at(new Date())),
	);
	expect(err.updatedAt).toBeNull();
	await failure(db.examException.delete(missing, at(new Date())));
	await expect(
		db.examException.update(missing, { note: "x" }, FULL_ACCESS),
	).rejects.toBeInstanceOf(NotFound);
	await expect(
		db.examException.update(
			{ ...missing, exam: tag("nope-") },
			{ note: "x" },
			at(new Date()),
		),
	).rejects.toBeInstanceOf(NotFound);
	expect(instructor).toBeDefined();
});

test("examException.upsert: null creates, then fails when it exists", async () => {
	const { key, course, exam } = await makeException();
	const other = await enroll(course.id);
	const fresh = {
		course: course.id,
		exam: exam.slug,
		username: other.username,
	};
	const created = await db.examException.upsert(
		{ ...fresh, extraTime: { minutes: 5 } },
		at(null),
	);
	const err = await failure(
		db.examException.upsert({ ...fresh, extraTime: { minutes: 5 } }, at(null)),
	);
	expect(err.updatedAt).toEqual(created.updatedAt);
	expect(key).toBeDefined();
});

test("examException.upsert: Date updates when right, fails when stale or absent", async () => {
	const { key, exception, course, exam } = await makeException();
	await failure(db.examException.upsert({ ...key, note: "x" }, at(STALE)));
	expect(await noteOf(exception.id)).toBeNull();
	const updated = await db.examException.upsert(
		{ ...key, note: "x" },
		at(exception.updatedAt),
	);
	expect(updated.note).toBe("x");
	const other = await enroll(course.id);
	const err = await failure(
		db.examException.upsert(
			{
				course: course.id,
				exam: exam.slug,
				username: other.username,
				extraTime: { minutes: 5 },
			},
			at(new Date()),
		),
	);
	expect(err.updatedAt).toBeNull();
});

test("examException.delete: right version deletes, stale throws and keeps it", async () => {
	const { key, exception } = await makeException();
	await failure(db.examException.delete(key, at(STALE)));
	expect(await db.examException.findOne(key, FULL_ACCESS)).not.toBeNull();
	await db.examException.delete(key, at(exception.updatedAt));
	expect(await db.examException.findOne(key, FULL_ACCESS)).toBeNull();
});

//
// Response
//

test("response.update: right version writes and bumps, stale throws and writes nothing", async () => {
	const { response } = await makeResponse();
	const err = await failure(
		db.response.update(
			{ id: response.id },
			{ acceptingSubmissions: false },
			at(STALE),
		),
	);
	expect(err.updatedAt).toEqual(response.updatedAt);
	expect(
		(await db.response.findOne({ id: response.id }, FULL_ACCESS))
			?.acceptingSubmissions,
	).toBe(true);
	const updated = await db.response.update(
		{ id: response.id },
		{ acceptingSubmissions: false },
		at(response.updatedAt),
	);
	expect(updated.acceptingSubmissions).toBe(false);
	expect(ms(updated.updatedAt)).toBeGreaterThan(ms(response.updatedAt));
});

test("response.update: a Date on a missing row is a 412 with null, none is a NotFound", async () => {
	const missing = { publicId: tag("nope-") };
	const err = await failure(
		db.response.update(
			missing,
			{ acceptingSubmissions: false },
			at(new Date()),
		),
	);
	expect(err.updatedAt).toBeNull();
	await expect(
		db.response.update(missing, { acceptingSubmissions: false }, FULL_ACCESS),
	).rejects.toBeInstanceOf(NotFound);
});

test("response.upsert: null creates, then fails when it exists", async () => {
	const { course, exam, student } = await makeAttempt();
	const input = {
		course: course.id,
		exam: exam.slug,
		author: student.username,
		acceptingSubmissions: true,
	};
	const created = await db.response.upsert(input, at(null));
	const err = await failure(db.response.upsert(input, at(null)));
	expect(err.updatedAt).toEqual(created.updatedAt);
});

test("response.upsert: a Date on a missing attempt is a 412 with null and creates nothing", async () => {
	const { course, exam, student } = await makeAttempt();
	const err = await failure(
		db.response.upsert(
			{ course: course.id, exam: exam.slug, author: student.username },
			at(new Date()),
		),
	);
	expect(err.updatedAt).toBeNull();
	expect(
		await prisma.response.count({ where: { authorId: student.username } }),
	).toBe(0);
});

test("response.upsert: Date updates when right, fails when stale", async () => {
	const { course, exam, student, response } = await makeResponse();
	const input = {
		course: course.id,
		exam: exam.slug,
		author: student.username,
		acceptingSubmissions: false,
	};
	await failure(db.response.upsert(input, at(STALE)));
	expect(
		(await db.response.findOne({ id: response.id }, FULL_ACCESS))
			?.acceptingSubmissions,
	).toBe(true);
	const updated = await db.response.upsert(input, at(response.updatedAt));
	expect(updated.acceptingSubmissions).toBe(false);
	expect(ms(updated.updatedAt)).toBeGreaterThan(ms(response.updatedAt));
});

test("response.delete: right version deletes, stale throws and keeps the submissions", async () => {
	const { course, exam, question, student } = await makeAttempt();
	const answered = await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: question.slug,
			payload: "a",
		},
		actorOf(student),
	);
	await failure(db.response.delete({ id: answered.id }, at(STALE)));
	expect(
		await prisma.submission.count({ where: { responseId: answered.id } }),
	).toBe(1);
	await db.response.delete({ id: answered.id }, at(answered.updatedAt));
	expect(
		await prisma.submission.count({ where: { responseId: answered.id } }),
	).toBe(0);
	expect(
		await db.response.findOne({ id: answered.id }, FULL_ACCESS),
	).toBeNull();
});

test("response.delete: a Date on a missing row is a 412 with null, none is a NotFound", async () => {
	const missing = { publicId: tag("nope-") };
	const err = await failure(db.response.delete(missing, at(new Date())));
	expect(err.updatedAt).toBeNull();
	await expect(db.response.delete(missing, FULL_ACCESS)).rejects.toBeInstanceOf(
		NotFound,
	);
});

//
// The student's path never fails on a version
//

test("a student saving and delivering keeps working while the version moves under them", async () => {
	const { course, exam, question, student, instructor } = await makeAttempt();
	const answer = (payload: string, expectedUpdatedAt?: Date | null) =>
		db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: question.slug,
				payload,
			},
			{
				...actorOf(student),
				...(expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt }),
			},
		);

	const first = await answer("one");
	// Each save is a change of the read model, so the version moves.
	const second = await answer("two");
	expect(ms(second.updatedAt)).toBeGreaterThan(ms(first.updatedAt));
	expect(second.submissions).toHaveLength(2);

	// Another writer moves it between two saves: the next one goes through.
	await db.response.update(
		{ id: first.id },
		{ acceptingSubmissions: true },
		{ ...actorOf(instructor), expectedUpdatedAt: second.updatedAt },
	);
	const third = await answer("three");
	expect(third.submissions).toHaveLength(3);

	// An expectation that reaches the student's calls is ignored, never a 412.
	const fourth = await answer("four", STALE);
	expect(fourth.submissions).toHaveLength(4);

	const finished = await db.response.finish(
		{ course: course.id, exam: exam.slug },
		{ ...actorOf(student), expectedUpdatedAt: STALE },
	);
	expect(finished.acceptingSubmissions).toBe(false);
	expect(ms(finished.updatedAt)).toBeGreaterThan(ms(fourth.updatedAt));
	// A version read before the delivery is now stale for whoever edits.
	await failure(
		db.response.update(
			{ id: first.id },
			{ acceptingSubmissions: true },
			{ ...actorOf(instructor), expectedUpdatedAt: fourth.updatedAt },
		),
	);
});

test("response.submit and the submission service move the version of the response they append to", async () => {
	const { course, exam, question, student, response } = await makeResponse();
	const sub = await db.submission.create(
		{
			response: { publicId: response.publicId },
			question: question.slug,
			payload: "a",
		},
		actorOf(student),
	);
	const afterCreate = await db.response.findOne(
		{ id: response.id },
		FULL_ACCESS,
	);
	expect(ms(afterCreate?.updatedAt ?? STALE)).toBeGreaterThan(
		ms(response.updatedAt),
	);

	await db.submission.update(
		{ publicId: sub.publicId },
		{ status: "GRADED_MANUALLY" },
		FULL_ACCESS,
	);
	const afterUpdate = await db.response.findOne(
		{ id: response.id },
		FULL_ACCESS,
	);
	expect(ms(afterUpdate?.updatedAt ?? STALE)).toBeGreaterThan(
		ms(afterCreate?.updatedAt ?? STALE),
	);

	await db.submission.delete({ publicId: sub.publicId }, FULL_ACCESS);
	const afterDelete = await db.response.findOne(
		{ id: response.id },
		FULL_ACCESS,
	);
	expect(ms(afterDelete?.updatedAt ?? STALE)).toBeGreaterThan(
		ms(afterUpdate?.updatedAt ?? STALE),
	);
	expect(course).toBeDefined();
	expect(exam).toBeDefined();
});

//
// Report
//

test("report.update: right version writes and bumps, stale throws and writes nothing", async () => {
	const { report, instructor } = await makeReport();
	const err = await failure(
		db.report.update({ publicId: report.publicId }, { note: "x" }, at(STALE)),
	);
	expect(err.updatedAt).toEqual(report.updatedAt);
	expect(
		(await db.report.findOne({ publicId: report.publicId }, FULL_ACCESS))?.note,
	).toBeNull();
	const updated = await db.report.update(
		{ publicId: report.publicId },
		{ note: "x" },
		at(report.updatedAt),
	);
	expect(updated.note).toBe("x");
	expect(ms(updated.updatedAt)).toBeGreaterThan(ms(report.updatedAt));
	expect(instructor).toBeDefined();
});

test("report.update: absent expectation writes", async () => {
	const { report } = await makeReport();
	const updated = await db.report.update(
		{ publicId: report.publicId },
		{ status: "TRIAGED" },
		FULL_ACCESS,
	);
	expect(updated.status).toBe("TRIAGED");
});

test("report.update and delete: a Date on a missing row is a 412 with null, none is a NotFound", async () => {
	const missing = { publicId: tag("nope-") };
	const err = await failure(
		db.report.update(missing, { note: "x" }, at(new Date())),
	);
	expect(err.updatedAt).toBeNull();
	await failure(db.report.delete(missing, at(new Date())));
	await expect(
		db.report.update(missing, { note: "x" }, FULL_ACCESS),
	).rejects.toBeInstanceOf(NotFound);
	await expect(db.report.delete(missing, FULL_ACCESS)).rejects.toBeInstanceOf(
		NotFound,
	);
});

test("report.delete: right version deletes, stale throws and keeps the attachments", async () => {
	const { report } = await makeReport({
		attachments: [{ filename: "a.png", bytes: Buffer.from("png") }],
	});
	await failure(db.report.delete({ publicId: report.publicId }, at(STALE)));
	expect(
		await prisma.attachment.count({
			where: { attachedToType: "REPORT", attachedToId: report.id },
		}),
	).toBe(1);
	await db.report.delete({ publicId: report.publicId }, at(report.updatedAt));
	expect(
		await prisma.attachment.count({
			where: { attachedToType: "REPORT", attachedToId: report.id },
		}),
	).toBe(0);
});

test("renaming a report's attachment bumps the report, which shows the file name", async () => {
	const { report } = await makeReport({
		attachments: [{ filename: "a.png", bytes: Buffer.from("png") }],
	});
	const file = await prisma.attachment.findFirstOrThrow({
		where: { attachedToType: "REPORT", attachedToId: report.id },
	});
	await db.attachment.update(
		{ id: file.id },
		{ filename: "b.png" },
		FULL_ACCESS,
	);
	const after = await db.report.findOne(
		{ publicId: report.publicId },
		FULL_ACCESS,
	);
	expect(after?.attachments.map((a) => a.filename)).toEqual(["b.png"]);
	expect(ms(after?.updatedAt ?? STALE)).toBeGreaterThan(ms(report.updatedAt));
});

//
// A row hidden from the actor answers as a missing one
//

test("exam: a draft that the actor may not see answers a Date as a missing exam does, a 412 with null", async () => {
	const { course } = await makeCourse();
	const student = await enroll(course.id);
	const draft = await makeExam(course.id, { status: "DRAFT" });
	const hidden = { course: course.id, slug: draft.slug };
	const absent = { course: course.id, slug: tag("nope-") };
	const as = (expected?: Date | null) => ({
		...actorOf(student),
		...(expected === undefined ? {} : { expectedUpdatedAt: expected }),
	});

	for (const run of [
		(filter: typeof hidden, expected?: Date | null) =>
			db.exam.update(filter, { title: "x" }, as(expected)),
		(filter: typeof hidden, expected?: Date | null) =>
			db.exam.delete(filter, as(expected)),
		(filter: typeof hidden, expected?: Date | null) =>
			db.exam.releaseGrades(filter, as(expected)),
	]) {
		const seen = await failure(run(hidden, draft.updatedAt));
		const missing = await failure(run(absent, draft.updatedAt));
		expect(seen.updatedAt).toBeNull();
		expect(missing.updatedAt).toBeNull();
		await expect(run(hidden)).rejects.toBeInstanceOf(NotFound);
		await expect(run(absent)).rejects.toBeInstanceOf(NotFound);
		await expect(run(hidden, null)).rejects.toBeInstanceOf(NotFound);
	}
});

test("response: another student's attempt answers a Date as a missing one does, a 412 with null", async () => {
	const { course, response } = await makeResponse();
	const other = await enroll(course.id);
	const hidden = { publicId: response.publicId };
	const absent = { publicId: tag("nope-") };
	const as = (expected?: Date | null) => ({
		...actorOf(other),
		...(expected === undefined ? {} : { expectedUpdatedAt: expected }),
	});

	for (const run of [
		(filter: typeof hidden, expected?: Date | null) =>
			db.response.update(filter, { acceptingSubmissions: false }, as(expected)),
		(filter: typeof hidden, expected?: Date | null) =>
			db.response.delete(filter, as(expected)),
	]) {
		const seen = await failure(run(hidden, response.updatedAt));
		const missing = await failure(run(absent, response.updatedAt));
		expect(seen.updatedAt).toBeNull();
		expect(missing.updatedAt).toBeNull();
		await expect(run(hidden)).rejects.toBeInstanceOf(NotFound);
		await expect(run(absent)).rejects.toBeInstanceOf(NotFound);
	}
	expect(
		(
			await prisma.response.findUniqueOrThrow({
				where: { publicId: response.publicId },
			})
		).acceptingSubmissions,
	).toBe(true);
});

test("question: a draft that the actor may not see answers a Date as a missing question does, a 412 with null", async () => {
	const { course } = await makeCourse();
	const student = await enroll(course.id);
	const draft = await persistedQuestionFactory.create(
		{ course: course.id, slug: tag("q-"), status: "DRAFT" },
		{ transient: { type: "essay" } },
	);
	const hidden = { course: course.id, slug: draft.slug };
	const absent = { course: course.id, slug: tag("nope-") };
	const as = (expected?: Date | null) => ({
		...actorOf(student),
		...(expected === undefined ? {} : { expectedUpdatedAt: expected }),
	});

	for (const run of [
		(filter: typeof hidden, expected?: Date | null) =>
			db.question.delete(filter, as(expected)),
	]) {
		expect((await failure(run(hidden, draft.updatedAt))).updatedAt).toBeNull();
		expect((await failure(run(absent, draft.updatedAt))).updatedAt).toBeNull();
		await expect(run(hidden)).rejects.toBeInstanceOf(NotFound);
		await expect(run(absent)).rejects.toBeInstanceOf(NotFound);
	}
});

test("report: another student's report answers a Date as a missing one does, a 412 with null", async () => {
	const { course, report } = await makeReport();
	const other = await enroll(course.id);
	const as = (expected?: Date | null) => ({
		...actorOf(other),
		...(expected === undefined ? {} : { expectedUpdatedAt: expected }),
	});
	const hidden = { publicId: report.publicId };
	const absent = { publicId: tag("nope-") };
	for (const run of [
		(filter: typeof hidden, expected?: Date | null) =>
			db.report.update(filter, { note: "x" }, as(expected)),
		(filter: typeof hidden, expected?: Date | null) =>
			db.report.delete(filter, as(expected)),
	]) {
		expect((await failure(run(hidden, STALE))).updatedAt).toBeNull();
		expect((await failure(run(absent, STALE))).updatedAt).toBeNull();
		await expect(run(hidden)).rejects.toBeInstanceOf(NotFound);
		await expect(run(absent)).rejects.toBeInstanceOf(NotFound);
	}
});
