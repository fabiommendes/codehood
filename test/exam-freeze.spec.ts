/**
 * The versions an exam serves and grades against freeze at the first attempt
 * that is not a simulation, at closing, or at the release of grades. Before
 * that a push still changes what the exam serves.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData } from "@/core/error";
import type { ExamId } from "@/core/schemas/base";
import { scoreValue } from "@/core/score";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { attemptOrEmpty } from "@/db/empty-attempt";
import { freezeQuestionVersions } from "@/db/services/exam-questions";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { multipleChoice } from "@/mdq/fixtures";
import {
	actorOf,
	enroll,
	makeCourse,
	tag,
} from "./conditional-write-exam-support";

const MINUTE = 60_000;

/// `minutes` from the real clock, negative for the past.
const fromNow = (minutes: number) => new Date(Date.now() + minutes * MINUTE);

/// A multiple-choice document with one correct choice and the other choices scoring nothing.
function choiceDoc(slug: string, correct: string, others: string[]) {
	return multipleChoice({
		id: slug,
		title: "Which one?",
		stem: "Pick the right one.",
		tags: [],
		choices: [
			{ id: correct, text: correct.toUpperCase(), score: 1 },
			...others.map((id) => ({ id, text: id.toUpperCase(), score: 0 })),
		],
	});
}

/// A course with an instructor and a student.
async function setup() {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course.id);
	return { course, instructor, student };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/// A published question whose first version is labelled `v1`.
async function makeQuestion(
	course: Setup["course"],
	doc: (slug: string) => ReturnType<typeof choiceDoc> = (slug) =>
		choiceDoc(slug, "a", ["b"]),
) {
	const slug = tag("q-");
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "v1",
			question: doc(slug),
		},
		FULL_ACCESS,
	);
	return slug;
}

/// Pushes a new version of a question, which becomes its latest.
function push(
	course: Setup["course"],
	slug: string,
	version: string,
	correct: string,
	others: string[],
) {
	return db.question.update(
		{ course: course.id, slug },
		{ version, question: choiceDoc(slug, correct, others) },
		FULL_ACCESS,
	);
}

/// An exam of `course` carrying `questions`, ongoing and graded by default.
function makeExam(
	course: Setup["course"],
	questions: { slug: string; version?: string }[],
	fields: Partial<Parameters<typeof persistedExamFactory.create>[0]> = {},
) {
	return persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		questions,
		...fields,
	});
}

/// The slug and pinned version of each question of the exam, in the exam's order.
async function pinsOf(examId: number) {
	const rows = await prisma.questionsForExam.findMany({
		where: { examId },
		orderBy: { position: "asc" },
		include: { questionRef: { select: { slug: true } } },
	});
	return rows.map((row) => ({
		slug: row.questionRef.slug,
		version: row.version,
	}));
}

/// The pinned version of each question, by slug.
async function pinBySlug(examId: number) {
	return Object.fromEntries(
		(await pinsOf(examId)).map((pin) => [pin.slug, pin.version]),
	);
}

/// The stored `questionsFrozenAt` of the exam.
async function frozenAt(examId: ExamId) {
	const exam = await prisma.exam.findUniqueOrThrow({ where: { id: examId } });
	return exam.questionsFrozenAt;
}

/// The `versionHash` of the latest version of the question.
async function latestHash(slug: string) {
	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { slug },
		select: { latest: { select: { versionHash: true } } },
	});
	return ref.latest?.versionHash;
}

/// The student opens an attempt at the exam.
function startAttempt(s: Setup, exam: { slug: string }, username: string) {
	return db.response.create(
		{ course: s.course.id, exam: exam.slug, author: username },
		actorOf({ ...s.student, username }),
	);
}

/// The student answers `question` with the id of a choice.
function answer(
	s: Setup,
	exam: { slug: string },
	question: string,
	payload: string,
) {
	return db.response.answer(
		{ course: s.course.id, exam: exam.slug, question, payload },
		actorOf(s.student),
	);
}

test("the first attempt freezes the unpinned questions, keeps the pinned ones and leaves a question with no version alone", async () => {
	const s = await setup();
	const other = await enroll(s.course.id);
	const q1 = await makeQuestion(s.course);
	const q2 = await makeQuestion(s.course);
	const q3 = tag("q-");
	const exam = await makeExam(s.course, [
		{ slug: q1, version: "v1" },
		{ slug: q2 },
	]);
	const ref = await prisma.questionRef.create({
		data: {
			publicId: tag("p"),
			slug: q3,
			courseId: s.course.id,
			type: "MULTIPLE_CHOICE",
		},
	});
	await prisma.questionsForExam.create({
		data: { examId: exam.id, questionRefId: ref.id, position: 2 },
	});
	await push(s.course, q1, "v2", "b", ["a"]);
	await push(s.course, q2, "v2", "b", ["a"]);

	const before = new Date();
	await startAttempt(s, exam, s.student.username);
	const after = new Date();

	expect(await pinBySlug(exam.id)).toEqual({
		[q1]: "v1",
		[q2]: "v2",
		[q3]: null,
	});
	const stamp = await frozenAt(exam.id);
	expect(stamp).not.toBeNull();
	expect(stamp?.getTime()).toBeGreaterThanOrEqual(before.getTime());
	expect(stamp?.getTime()).toBeLessThanOrEqual(after.getTime());

	await startAttempt(s, exam, other.username);
	expect(await frozenAt(exam.id)).toEqual(stamp);
	expect(await pinBySlug(exam.id)).toEqual({
		[q1]: "v1",
		[q2]: "v2",
		[q3]: null,
	});

	const read = await db.exam.findOne(
		{ course: s.course.id, slug: exam.slug },
		actorOf(s.instructor),
	);
	expect(read?.questionsFrozenAt).toEqual(stamp);
	expect(
		Object.fromEntries((read?.questions ?? []).map((q) => [q.slug, q.version])),
	).toEqual({ [q1]: "v1", [q2]: "v2", [q3]: null });
});

test("a push after the first attempt changes neither what the answer is validated against nor how it is graded", async () => {
	const s = await setup();
	const q1 = await makeQuestion(s.course);
	const exam = await makeExam(s.course, [{ slug: q1 }]);

	await answer(s, exam, q1, "a");
	expect(await pinBySlug(exam.id)).toEqual({ [q1]: "v1" });

	await push(s.course, q1, "v2", "b", ["z"]);
	await answer(s, exam, q1, "a");
	await expect(answer(s, exam, q1, "z")).rejects.toBeInstanceOf(InvalidData);
	await db.response.finish(
		{ course: s.course.id, exam: exam.slug },
		actorOf(s.student),
	);

	const submissions = await prisma.submission.findMany({
		where: { response: { examId: exam.id }, question: { slug: q1 } },
		include: { feedbacks: true },
		orderBy: { id: "asc" },
	});
	const last = submissions.at(-1);
	expect(last?.payload).toBe("a");
	expect(last?.feedbacks).toHaveLength(1);
	expect(scoreValue(last?.feedbacks[0]?.score ?? "")).toBe(1);
});

test("a push before any attempt still changes what the exam serves, and the first answer pins the version it was checked against", async () => {
	const s = await setup();
	const q1 = await makeQuestion(s.course);
	const exam = await makeExam(s.course, [{ slug: q1 }]);

	await push(s.course, q1, "v2", "z", ["a"]);
	expect(await pinBySlug(exam.id)).toEqual({ [q1]: null });
	expect(await frozenAt(exam.id)).toBeNull();

	await expect(answer(s, exam, q1, "z")).resolves.toBeDefined();
	expect(await pinBySlug(exam.id)).toEqual({ [q1]: "v2" });
});

/// The paths that freeze an exam with no attempt of a student, each acting on `exam` of `s`.
const FREEZERS: [
	string,
	boolean,
	(s: Setup, exam: { id: ExamId; slug: string }) => Promise<unknown>,
][] = [
	[
		"an empty attempt for a student who missed it",
		true,
		(s, exam) =>
			prisma.$transaction((tx) =>
				attemptOrEmpty(tx, {
					examId: exam.id,
					author: s.student.username,
					createdBy: s.instructor.username,
					now: new Date(),
					field: "author",
					requireFinished: false,
				}),
			),
	],
	[
		"releasing the grades",
		true,
		(s, exam) =>
			db.exam.releaseGrades(
				{ course: s.course.id, slug: exam.slug },
				actorOf(s.instructor),
			),
	],
	[
		"closing the exam",
		false,
		(s, exam) =>
			db.exam.close(
				{ course: s.course.id, slug: exam.slug },
				actorOf(s.instructor),
			),
	],
	[
		"updating the status to COMPLETED",
		false,
		(s, exam) =>
			db.exam.update(
				{ course: s.course.id, slug: exam.slug },
				{ status: "COMPLETED" },
				actorOf(s.instructor),
			),
	],
];

for (const [label, endedByClock, act] of FREEZERS) {
	test(`${label} freezes the unpinned questions of an exam no student attempted`, async () => {
		const s = await setup();
		const slug = await makeQuestion(s.course);
		const exam = await makeExam(s.course, [{ slug }], {
			status: endedByClock ? "SCHEDULED" : "ONGOING",
			...(endedByClock
				? { scheduledAt: fromNow(-180), duration: { minutes: 60 } }
				: {}),
		});
		await push(s.course, slug, "v2", "b", ["a"]);

		await act(s, exam);

		expect(await pinBySlug(exam.id)).toEqual({
			[slug]: await latestHash(slug),
		});
		expect(await frozenAt(exam.id)).not.toBeNull();
	});
}

test("rewriting the questions of a frozen exam keeps the pins, fixes the new question and drops the removed one", async () => {
	const s = await setup();
	const q1 = await makeQuestion(s.course);
	const q2 = await makeQuestion(s.course);
	const q3 = await makeQuestion(s.course);
	await push(s.course, q3, "v4", "b", ["a"]);
	const exam = await makeExam(s.course, [{ slug: q1 }, { slug: q2 }]);
	await startAttempt(s, exam, s.student.username);
	await push(s.course, q1, "v2", "b", ["a"]);

	await db.exam.upsert(
		{
			course: s.course.id,
			slug: exam.slug,
			title: exam.title,
			questions: [{ slug: q3 }, { slug: q1, version: "v2" }],
		},
		actorOf(s.instructor),
	);

	expect(await pinsOf(exam.id)).toEqual([
		{ slug: q3, version: "v4" },
		{ slug: q1, version: "v1" },
	]);
});

test("a practice exam never freezes: a push still changes what it serves", async () => {
	const s = await setup();
	const q1 = await makeQuestion(s.course);
	const exam = await makeExam(s.course, [{ slug: q1 }], { type: "PRACTICE" });

	await startAttempt(s, exam, s.student.username);
	await answer(s, exam, q1, "a");
	expect(await frozenAt(exam.id)).toBeNull();
	expect(await pinBySlug(exam.id)).toEqual({ [q1]: null });

	await push(s.course, q1, "v2", "z", ["a"]);
	await answer(s, exam, q1, "z");
	expect(await frozenAt(exam.id)).toBeNull();
	expect(await pinBySlug(exam.id)).toEqual({ [q1]: null });
});

test("the instructor's simulation does not freeze the exam, but a student's attempt does", async () => {
	const s = await setup();
	const q1 = await makeQuestion(s.course);
	const exam = await makeExam(s.course, [{ slug: q1 }]);
	const ref = { course: s.course.id, exam: exam.slug };
	const teacher = actorOf(s.instructor);
	const untouched = async () => {
		expect(await frozenAt(exam.id)).toBeNull();
		expect(await pinBySlug(exam.id)).toEqual({ [q1]: null });
	};

	await db.response.create(ref, teacher);
	await untouched();
	await db.response.answer({ ...ref, question: q1, payload: "a" }, teacher);
	await untouched();
	await db.response.restartPreview(ref, teacher);
	await untouched();

	await startAttempt(s, exam, s.student.username);
	expect(await pinBySlug(exam.id)).toEqual({ [q1]: "v1" });
	expect(await frozenAt(exam.id)).not.toBeNull();
});

test("freezing again does not overwrite a pin that a concurrent freeze already wrote", async () => {
	const s = await setup();
	const q1 = await makeQuestion(s.course);
	const exam = await makeExam(s.course, [{ slug: q1 }]);
	await startAttempt(s, exam, s.student.username);
	// A transaction that read the exam before the stamp saw it unfrozen.
	await prisma.exam.update({
		where: { id: exam.id },
		data: { questionsFrozenAt: null },
	});
	await push(s.course, q1, "v2", "b", ["a"]);

	await freezeQuestionVersions(prisma, exam.id);

	expect(await pinBySlug(exam.id)).toEqual({ [q1]: "v1" });
	expect(await frozenAt(exam.id)).not.toBeNull();
});
