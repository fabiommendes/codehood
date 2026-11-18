/**
 * The service `db.examQuestion`: what a student reads of an exam's questions
 * through the exam grant.
 *
 * Every case is a unit case: the service runs straight on the database.
 */
import { expect, test } from "@playwright/test";
import type { z } from "zod";
import { FULL_ACCESS } from "@/auth/actor";
import type { questionSchema } from "@/core/schemas/question";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice, essay, sumCode } from "@/mdq/fixtures";
import { pretestSources } from "@/utils/pretest-sources";
import {
	actorOf,
	enroll,
	makeCourse,
	tag,
} from "./conditional-write-exam-support";

type Doc = z.infer<typeof questionSchema>["question"];

const MINUTE = 60_000;

/// `minutes` from the real clock, negative for the past.
const fromNow = (minutes: number) => new Date(Date.now() + minutes * MINUTE);

/// The multiple-choice document of the spec: weight 2, tag `geo`, `brasilia` is right and `rio` is worth 0.
const mc: Doc = { ...capitalChoice, weight: 2, tags: ["geo"] };

/// The push of `v2` over `mc`: other texts, weight 3, and `rio` is right, with a feedback.
const mcV2: Doc = {
	...capitalChoice,
	title: "Capital of Brazil, second edition",
	stem: "V2 stem: name the capital.",
	weight: 3,
	tags: ["geo"],
	choices: [
		{ id: "brasilia", text: "Brasília", score: 0 },
		{ id: "rio", text: "Rio de Janeiro", score: 1, feedback: "V2 FEEDBACK" },
		{ id: "sao-paulo", text: "São Paulo", score: -0.5 },
	],
};

/// Another multiple-choice question, for the classmate.
const mc2: Doc = {
	...capitalChoice,
	title: "Capital of Argentina",
	stem: "Which city is the capital of Argentina?",
	tags: [],
	choices: [
		{ id: "ba", text: "Buenos Aires", score: 1 },
		{ id: "cb", text: "Córdoba", score: 0 },
	],
};

/// An essay with no `weight`, with tags.
const essayDoc: Doc = essay({
	id: "essay",
	title: "Why recursion",
	stem: "Argue for recursion.",
	content: "plain",
	tags: ["essay"],
});

/// `sumCode` with a test source whose only region is public, so the browser may run it as a pretest.
const publicSum = {
	...sumCode,
	tests: [
		{
			format: "pytest",
			text: [
				"from sum import add",
				"",
				"# mdq: [0] {public} Adds small numbers",
				"def test_small():",
				"    assert add(1, 2) == 3",
				"",
			].join("\n"),
		},
	],
};

/// A code question that names a worker, so the student can send it.
const codeDoc: Doc = {
	...publicSum,
	meta: { worker: "py-test" },
	tags: ["code"],
};

/// The same code question with no worker.
const codeNoWorker: Doc = (() => {
	const { meta: _meta, ...rest } = publicSum;
	return { ...rest, tags: ["code"] } as Doc;
})();

/// A course with an instructor, a student and a classmate.
async function world() {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course.id);
	const classmate = await enroll(course.id);
	return { course, instructor, student, classmate };
}

type World = Awaited<ReturnType<typeof world>>;

/// Publishes `doc` as the `v1` of a new question of the course, and returns its slug.
async function put(w: World, doc: Doc): Promise<string> {
	const slug = tag("q-");
	await db.question.create(
		{
			course: w.course.id,
			slug,
			status: "PUBLISHED",
			version: "v1",
			question: { ...doc, id: slug } as Doc,
		},
		FULL_ACCESS,
	);
	return slug;
}

/// Pushes `doc` as the new latest version of the question.
async function push(w: World, slug: string, version: string, doc: Doc) {
	await db.question.update(
		{ course: w.course.id, slug },
		{ version, question: { ...doc, id: slug } as Doc },
		FULL_ACCESS,
	);
}

type ExamFields = Partial<Parameters<typeof persistedExamFactory.create>[0]>;

/// An `EXAM` that opened ten minutes ago and runs for an hour.
function examOf(
	w: World,
	questions: { slug: string; version?: string }[],
	fields: ExamFields = {},
) {
	return persistedExamFactory.create({
		course: w.course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: fromNow(-10),
		duration: { minutes: 60 },
		questions,
		...fields,
	});
}

type Exam = Awaited<ReturnType<typeof examOf>>;

const pkOf = (w: World, exam: Exam) => ({
	course: w.course.id,
	slug: exam.slug,
});

const targetOf = (w: World, exam: Exam) => ({
	course: w.course.id,
	exam: exam.slug,
});

type Who = World["student"] | World["instructor"];

const start = (w: World, exam: Exam, user: Who = w.student) =>
	db.response.create(targetOf(w, exam), actorOf(user));

const answer = (
	w: World,
	exam: Exam,
	question: string,
	payload: unknown,
	user: Who = w.student,
) =>
	db.response.answer(
		{ ...targetOf(w, exam), question, payload: payload as never },
		actorOf(user),
	);

const finish = (w: World, exam: Exam, user: Who = w.student) =>
	db.response.finish(targetOf(w, exam), actorOf(user));

const forAttempt = (w: World, exam: Exam, user: Who = w.student) =>
	db.examQuestion.forAttempt(targetOf(w, exam), actorOf(user));

const titles = (w: World, exam: Exam, user: Who = w.student) =>
	db.examQuestion.titles(targetOf(w, exam), actorOf(user));

type Outcome = {
	question: string;
	submission: string;
	score: number;
	blanks: null;
};

const reviews = (
	w: World,
	exam: Exam,
	outcomes: Outcome[],
	user: Who = w.student,
) => db.examQuestion.reviews(targetOf(w, exam), outcomes, actorOf(user));

/// The public id of the last submission of `question` in the attempt of `user`.
async function submissionOf(
	exam: Exam,
	question: string,
	user: Who,
): Promise<string> {
	const row = await prisma.submission.findFirstOrThrow({
		where: {
			response: { examId: exam.id, authorId: user.username },
			question: { slug: question },
		},
		orderBy: { id: "desc" },
	});
	return row.publicId;
}

/// Closes the exam by hand and releases the grades.
async function closeAndRelease(w: World, exam: Exam) {
	await db.exam.close(pkOf(w, exam), actorOf(w.instructor));
	await db.exam.releaseGrades(pkOf(w, exam), actorOf(w.instructor));
}

test("the student reads the questions of the attempt in exam order, at the pinned version and with the weight of that version", async () => {
	const w = await world();
	const mcSlug = await put(w, mc);
	const essaySlug = await put(w, essayDoc);
	const exam = await examOf(w, [
		{ slug: essaySlug },
		{ slug: mcSlug, version: "v1" },
	]);
	await push(w, mcSlug, "v2", mcV2);

	expect(await forAttempt(w, exam)).toBeNull();
	expect(await titles(w, exam)).toEqual({});

	await start(w, exam);

	const read = await forAttempt(w, exam);
	expect(read).toMatchObject({ view: "answer", answering: true });
	const questions = read?.questions ?? [];
	expect(questions.map((q) => q.slug)).toEqual([essaySlug, mcSlug]);
	expect(questions[0]).toMatchObject({ slug: essaySlug, weight: 1 });
	expect(questions[1]).toMatchObject({
		slug: mcSlug,
		version: "v1",
		weight: 2,
		question: { stem: capitalChoice.stem },
	});
	for (const item of questions) {
		expect(item.question).not.toHaveProperty("tags");
		expect(item).not.toHaveProperty("code");
	}
	const json = JSON.stringify(read);
	expect(json).not.toContain("V2 stem");
	expect(json).not.toContain('"score"');

	expect(await titles(w, exam)).toEqual({
		[mcSlug]: capitalChoice.title,
		[essaySlug]: "Why recursion",
	});
});

test("a code question carries its pretests while the attempt answers, and a question that is not code has no code context", async () => {
	expect(pretestSources(publicSum)).not.toHaveLength(0);
	const w = await world();
	const codeSlug = await put(w, codeDoc);
	const bareSlug = await put(w, codeNoWorker);
	const mcSlug = await put(w, mc);
	const exam = await examOf(w, [
		{ slug: codeSlug },
		{ slug: bareSlug },
		{ slug: mcSlug },
	]);
	await start(w, exam);

	const bySlug = (read: Awaited<ReturnType<typeof forAttempt>>, slug: string) =>
		read?.questions.find((q) => q.slug === slug);

	const during = await forAttempt(w, exam);
	expect(during?.answering).toBe(true);
	expect(bySlug(during, codeSlug)?.code?.sendable).toBe(true);
	expect(bySlug(during, codeSlug)?.code?.pretests.length).toBeGreaterThan(0);
	expect(bySlug(during, bareSlug)?.code?.sendable).toBe(false);
	expect(bySlug(during, mcSlug)).not.toHaveProperty("code");

	await finish(w, exam);

	const after = await forAttempt(w, exam);
	expect(after?.answering).toBe(false);
	expect(bySlug(after, codeSlug)?.code).toEqual({
		sendable: true,
		pretests: [],
	});
	expect(bySlug(after, mcSlug)).not.toHaveProperty("code");
});

test("a review waits for the release, belongs to the student's own attempt and is the pinned version's, with no answer key", async () => {
	const w = await world();
	const mcSlug = await put(w, mc);
	const mc2Slug = await put(w, mc2);
	const exam = await examOf(w, [
		{ slug: mcSlug, version: "v1" },
		{ slug: mc2Slug },
	]);
	await answer(w, exam, mcSlug, "rio");
	await answer(w, exam, mc2Slug, "ba", w.classmate);
	await finish(w, exam);
	await finish(w, exam, w.classmate);
	await push(w, mcSlug, "v2", mcV2);

	const outcomes: Outcome[] = [
		{
			question: mcSlug,
			submission: await submissionOf(exam, mcSlug, w.student),
			score: 0.25,
			blanks: null,
		},
		{
			question: mc2Slug,
			submission: await submissionOf(exam, mc2Slug, w.classmate),
			score: 1,
			blanks: null,
		},
	];

	expect(await reviews(w, exam, outcomes)).toEqual({});

	await closeAndRelease(w, exam);

	const result = await reviews(w, exam, outcomes);
	expect(Object.keys(result)).toEqual([mcSlug]);
	expect(result[mcSlug]).toMatchObject({ score: 0.25 });
	const json = JSON.stringify(result);
	expect(json).not.toContain("brasilia");
	expect(json).not.toContain("V2 FEEDBACK");
});

test("a student who missed the exam reads nothing until the release, then only the public questions, with no review", async () => {
	const w = await world();
	const mcSlug = await put(w, mc);
	const essaySlug = await put(w, essayDoc);
	const exam = await examOf(w, [{ slug: mcSlug }, { slug: essaySlug }]);
	await db.exam.close(pkOf(w, exam), actorOf(w.instructor));

	expect(await forAttempt(w, exam)).toBeNull();

	await db.exam.releaseGrades(pkOf(w, exam), actorOf(w.instructor));

	const read = await forAttempt(w, exam);
	expect(read).toMatchObject({ view: "answer", answering: false });
	expect(read?.questions.map((q) => q.slug)).toEqual([mcSlug, essaySlug]);
	for (const item of read?.questions ?? []) {
		expect(item).not.toHaveProperty("code");
	}
	expect(await reviews(w, exam, [])).toEqual({});
	expect(
		await reviews(w, exam, [
			{ question: mcSlug, submission: tag("s"), score: 1, blanks: null },
		]),
	).toEqual({});
	expect(Object.keys(await titles(w, exam)).sort()).toEqual(
		[mcSlug, essaySlug].sort(),
	);
});

test("the instructor's simulation reads through the student's path, at the pinned version", async () => {
	const w = await world();
	const mcSlug = await put(w, mc);
	const exam = await examOf(w, [{ slug: mcSlug, version: "v1" }], {
		status: "DRAFT",
	});
	await push(w, mcSlug, "v2", mcV2);

	expect(await forAttempt(w, exam, w.instructor)).toBeNull();

	await start(w, exam, w.instructor);

	const read = await forAttempt(w, exam, w.instructor);
	expect(read).toMatchObject({ view: "answer", answering: true });
	expect(read?.questions).toHaveLength(1);
	expect(read?.questions[0]).toMatchObject({
		slug: mcSlug,
		version: "v1",
		question: { stem: capitalChoice.stem },
	});
	expect(JSON.stringify(read)).not.toContain("V2 stem");

	await answer(w, exam, mcSlug, "rio", w.instructor);
	await finish(w, exam, w.instructor);

	const result = await reviews(
		w,
		exam,
		[
			{
				question: mcSlug,
				submission: await submissionOf(exam, mcSlug, w.instructor),
				score: 0,
				blanks: null,
			},
		],
		w.instructor,
	);
	expect(Object.keys(result)).toEqual([mcSlug]);
});
