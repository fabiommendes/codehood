/**
 * The exam grant: who gets one, what it names, and how the readers check it.
 *
 * Every case is a unit case: the grant is issued and read straight from the
 * database, so no page, request or browser takes part.
 */
import { expect, test } from "@playwright/test";
import type { z } from "zod";
import { type Actor, FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { ImproperBehavior, NotFound } from "@/core/error";
import type { questionSchema } from "@/core/schemas/question";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { attemptOrEmpty } from "@/db/empty-attempt";
import {
	assertExamGrant,
	type ExamGrant,
	grantedDocument,
	grantedQuestions,
	grantViews,
	issueExamGrant,
} from "@/db/services/exam-questions";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
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

/// The actor of a user, as the grant functions take it.
const who = (user: Parameters<typeof actorOf>[0]): Actor => actorOf(user).actor;

/// A multiple-choice document whose stem says which version it is.
const choiceDoc = (stem: string): Doc => ({
	type: "multiple-choice",
	title: "Recursion basics",
	stem,
	tags: [],
	choices: [
		{ id: "a", text: "A base case", score: 1 },
		{ id: "b", text: "A tail call" },
	],
});

type ExamFields = Partial<Parameters<typeof persistedExamFactory.create>[0]>;

/// A course with an instructor, a student, a classmate and two questions in `v1`.
async function world() {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course.id);
	const classmate = await enroll(course.id);
	const q1 = await question(course.id);
	const q2 = await question(course.id);
	return { course, instructor, student, classmate, q1, q2 };
}

type World = Awaited<ReturnType<typeof world>>;

/// A published question of the course with a `v1`, and its slug.
async function question(courseId: World["course"]["id"]): Promise<string> {
	const slug = tag("q-");
	await db.question.create(
		{
			course: courseId,
			slug,
			status: "PUBLISHED",
			version: "v1",
			question: choiceDoc(`${slug} stem v1`),
		},
		FULL_ACCESS,
	);
	return slug;
}

/// Pushes a new version of the question, which becomes its latest.
async function push(w: World, slug: string, version: string) {
	await db.question.update(
		{ course: w.course.id, slug },
		{ version, question: choiceDoc(`${slug} stem ${version}`) },
		FULL_ACCESS,
	);
}

/// An `EXAM` that opened ten minutes ago and runs for an hour, holding the two questions unpinned.
function examOf(w: World, fields: ExamFields = {}) {
	return persistedExamFactory.create({
		course: w.course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: fromNow(-10),
		duration: { minutes: 60 },
		questions: [{ slug: w.q1 }, { slug: w.q2 }],
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

/// The student starts their attempt at the exam.
const start = (w: World, exam: Exam, user = w.student) =>
	db.response.create({ course: w.course.id, exam: exam.slug }, actorOf(user));

/// What the student is granted at the exam, with `now` for the clock.
const grantOf = (w: World, exam: Exam, user = w.student, now?: Date) =>
	issueExamGrant(prisma, targetOf(w, exam), who(user), now);

/// Narrows a grant that the case needs to exist.
function granted(grant: ExamGrant | null): ExamGrant {
	if (!grant) throw new Error("expected a grant, got null");
	return grant;
}

/// The id of the stored version `version` of the question.
async function dataIdOf(w: World, slug: string, version: string) {
	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: w.course.id, slug },
	});
	const row = await prisma.questionData.findUniqueOrThrow({
		where: { refId_versionHash: { refId: ref.id, versionHash: version } },
	});
	return row.id;
}

/// The pin of each question of the exam, in exam order.
async function pinsOf(exam: Exam) {
	const rows = await prisma.questionsForExam.findMany({
		where: { examId: exam.id },
		orderBy: { position: "asc" },
	});
	return rows.map((row) => row.version);
}

const frozenAtOf = async (exam: Exam) =>
	(await prisma.exam.findUniqueOrThrow({ where: { id: exam.id } }))
		.questionsFrozenAt;

/// An attempt created straight in the database, which no freezing sees.
async function rawAttempt(w: World, exam: Exam, user = w.student) {
	return prisma.response.create({
		data: {
			publicId: tag("r"),
			authorId: user.username,
			examId: exam.id,
			slotKey: 0,
			preview: false,
		},
	});
}

const slugsOf = (list: { slug: string }[]) => list.map((q) => q.slug);

test("only the student who owns the attempt gets a grant, not SYSTEM, the instructor or a classmate", async () => {
	const w = await world();
	const exam = await examOf(w);
	const response = await start(w, exam);

	expect(await grantOf(w, exam)).not.toBeNull();
	expect(await issueExamGrant(prisma, targetOf(w, exam), SYSTEM)).toBeNull();
	for (const other of [w.instructor, w.classmate]) {
		expect(
			await issueExamGrant(prisma, { response: response.publicId }, who(other)),
		).toBeNull();
	}
});

test("there is no grant before the exam opens", async () => {
	const w = await world();
	const exam = await examOf(w, { scheduledAt: fromNow(24 * 60) });

	expect(await grantOf(w, exam)).toBeNull();
});

test("a student who has not started the attempt has no grant on an open exam", async () => {
	const w = await world();
	const exam = await examOf(w);

	expect(await grantOf(w, exam)).toBeNull();
});

test("the grant names the attempt, expires in 60 s and lists the questions in exam order, each at its resolved version", async () => {
	const w = await world();
	await push(w, w.q1, "v2");
	const exam = await examOf(w, {
		questions: [{ slug: w.q2 }, { slug: w.q1, version: "v1" }],
	});
	const response = await start(w, exam);

	const t = new Date();
	const grant = granted(await grantOf(w, exam, w.student, t));
	expect(grant).toMatchObject({
		username: w.student.username,
		courseId: w.course.id,
		examId: exam.id,
		responseId: response.id,
		view: "answer",
		answering: true,
	});
	expect(grant.expiresAt).toEqual(new Date(t.getTime() + 60_000));
	expect(grant.questions.map((q) => [q.slug, q.version, q.dataId])).toEqual([
		[w.q2, "v1", await dataIdOf(w, w.q2, "v1")],
		[w.q1, "v1", await dataIdOf(w, w.q1, "v1")],
	]);

	const read = await grantedQuestions(prisma, grant, who(w.student));
	expect(slugsOf(read)).toEqual([w.q2, w.q1]);
	const json = JSON.stringify(read);
	expect(json).toContain(`${w.q1} stem v1`);
	expect(json).not.toContain("stem v2");
	expect(json).not.toContain('"score"');
});

test("a grant is not issued after the exam is archived or sent back to draft, the exception is removed or the student leaves the course", async () => {
	await test.step("the exam is archived", async () => {
		const w = await world();
		const exam = await examOf(w);
		const response = await start(w, exam);
		expect(await grantOf(w, exam)).not.toBeNull();

		await db.exam.update(
			pkOf(w, exam),
			{ status: "ARCHIVED" },
			actorOf(w.instructor),
		);
		expect(await grantOf(w, exam)).toBeNull();

		const outsider = await persistedUserFactory.create({ role: "STUDENT" });
		expect(
			await issueExamGrant(prisma, targetOf(w, exam), who(outsider)),
		).toBeNull();
		expect(
			await issueExamGrant(
				prisma,
				{ response: response.publicId },
				who(outsider),
			),
		).toBeNull();
	});

	await test.step("the exam goes back to draft", async () => {
		const w = await world();
		const exam = await examOf(w);
		await start(w, exam);
		expect(await grantOf(w, exam)).not.toBeNull();

		await db.exam.update(
			pkOf(w, exam),
			{ status: "DRAFT" },
			actorOf(w.instructor),
		);
		expect(await grantOf(w, exam)).toBeNull();
	});

	await test.step("the exception that brought the exam forward is removed", async () => {
		const w = await world();
		const exam = await examOf(w, { scheduledAt: fromNow(24 * 60) });
		await db.examException.create(
			{
				course: w.course.id,
				exam: exam.slug,
				username: w.student.username,
				extraTime: { minutes: 0 },
				scheduledAt: fromNow(-10),
			},
			actorOf(w.instructor),
		);
		await start(w, exam);
		expect(await grantOf(w, exam)).not.toBeNull();

		await db.examException.delete(
			{
				course: w.course.id,
				exam: exam.slug,
				username: w.student.username,
			},
			actorOf(w.instructor),
		);
		expect(await grantOf(w, exam)).toBeNull();
	});

	await test.step("the student is unenrolled", async () => {
		const w = await world();
		const exam = await examOf(w);
		await start(w, exam);
		expect(await grantOf(w, exam)).not.toBeNull();

		await db.enrollment.delete(
			{ course: w.course.id, username: w.student.username },
			FULL_ACCESS,
		);
		expect(await grantOf(w, exam)).toBeNull();
	});
});

test("a second-call student answers in their own window while the class is closed, and a distant exception grants nothing", async () => {
	const w = await world();
	const exam = await examOf(w, { scheduledAt: fromNow(-3 * 60) });
	const exception = (user: typeof w.student, scheduledAt: Date) =>
		db.examException.create(
			{
				course: w.course.id,
				exam: exam.slug,
				username: user.username,
				extraTime: { minutes: 0 },
				scheduledAt,
			},
			actorOf(w.instructor),
		);
	await exception(w.student, fromNow(24 * 60));
	await exception(w.classmate, fromNow(-10));
	await start(w, exam, w.classmate);

	expect(await grantOf(w, exam, w.student)).toBeNull();

	const now = new Date();
	expect(await grantOf(w, exam, w.classmate, now)).toMatchObject({
		view: "answer",
		answering: true,
	});
	expect(
		await grantOf(w, exam, w.classmate, new Date(now.getTime() + 120 * MINUTE)),
	).toMatchObject({ view: "answer", answering: false });
});

test("extra time keeps the attempt answering past the class, but never reopens an exam closed by hand", async () => {
	const w = await world();
	const exam = await examOf(w);
	await db.examException.create(
		{
			course: w.course.id,
			exam: exam.slug,
			username: w.student.username,
			extraTime: { minutes: 30 },
		},
		actorOf(w.instructor),
	);
	await start(w, exam);
	await start(w, exam, w.classmate);

	// The class closes 50 minutes from now.
	const later = fromNow(55);
	expect(await grantOf(w, exam, w.student, later)).toMatchObject({
		view: "answer",
		answering: true,
	});
	expect(await grantOf(w, exam, w.classmate, later)).toMatchObject({
		view: "answer",
		answering: false,
	});

	await db.exam.close(pkOf(w, exam), actorOf(w.instructor));
	expect(await grantOf(w, exam, w.student, later)).toMatchObject({
		view: "answer",
		answering: false,
	});
});

test("a submitted attempt reads the questions, and reads the review once the grades are out", async () => {
	await test.step("an EXAM, closed and then released", async () => {
		const w = await world();
		const exam = await examOf(w);
		await start(w, exam);
		await db.response.finish(
			{ course: w.course.id, exam: exam.slug },
			actorOf(w.student),
		);
		await db.exam.close(pkOf(w, exam), actorOf(w.instructor));

		expect(await grantOf(w, exam)).toMatchObject({
			view: "answer",
			answering: false,
		});

		await db.exam.releaseGrades(pkOf(w, exam), actorOf(w.instructor));
		expect(await grantOf(w, exam)).toMatchObject({
			view: "review",
			answering: false,
		});
	});

	await test.step("a QUIZ releases only when every second call is over", async () => {
		const w = await world();
		const exam = await examOf(w, { type: "QUIZ" });
		await db.examException.create(
			{
				course: w.course.id,
				exam: exam.slug,
				username: w.classmate.username,
				extraTime: { minutes: 0 },
				scheduledAt: fromNow(60),
			},
			actorOf(w.instructor),
		);
		await start(w, exam);
		await db.response.finish(
			{ course: w.course.id, exam: exam.slug },
			actorOf(w.student),
		);

		// The class is over at +50 minutes, the classmate's call is at +60.
		expect(await grantOf(w, exam, w.student, fromNow(55))).toMatchObject({
			view: "answer",
		});
		expect(await grantOf(w, exam, w.student, fromNow(3 * 60))).toMatchObject({
			view: "review",
		});
	});
});

test("a student who missed the exam reads the statements, and only after the grades are released", async () => {
	const w = await world();
	const exam = await examOf(w);
	await db.exam.close(pkOf(w, exam), actorOf(w.instructor));

	expect(await grantOf(w, exam)).toBeNull();

	await db.exam.releaseGrades(pkOf(w, exam), actorOf(w.instructor));
	const grant = granted(await grantOf(w, exam));
	expect(grant).toMatchObject({
		view: "answer",
		responseId: null,
		answering: false,
	});
	expect(slugsOf([...grant.questions])).toEqual([w.q1, w.q2]);
	expect(
		slugsOf(await grantedQuestions(prisma, grant, who(w.student))),
	).toEqual([w.q1, w.q2]);
});

test("an empty attempt made for a student counts as a miss until the grades are released", async () => {
	const w = await world();
	const exam = await examOf(w);
	await db.exam.close(pkOf(w, exam), actorOf(w.instructor));
	const empty = await prisma.$transaction((tx) =>
		attemptOrEmpty(tx, {
			examId: exam.id,
			author: w.student.username,
			createdBy: w.instructor.username,
			now: new Date(),
			field: "author",
			requireFinished: false,
		}),
	);
	expect(empty.created).toBe(true);

	expect(await grantOf(w, exam)).toBeNull();

	await db.exam.releaseGrades(pkOf(w, exam), actorOf(w.instructor));
	expect(await grantOf(w, exam)).toMatchObject({ view: "review" });
});

test("the instructor's simulation gets a grant on a draft exam and leaves the versions unfrozen", async () => {
	const w = await world();
	const exam = await examOf(w, {
		status: "DRAFT",
		scheduledAt: undefined,
		duration: undefined,
		questions: [{ slug: w.q1 }],
	});
	const instructor = who(w.instructor);
	const issue = () => issueExamGrant(prisma, targetOf(w, exam), instructor);

	expect(await issue()).toBeNull();

	await start(w, exam, w.instructor);
	expect(await issue()).toMatchObject({ view: "answer", answering: true });

	await db.response.finish(
		{ course: w.course.id, exam: exam.slug },
		actorOf(w.instructor),
	);
	expect(await issue()).toMatchObject({ view: "review" });

	expect(await frozenAtOf(exam)).toBeNull();
	expect(await pinsOf(exam)).toEqual([null]);
});

test("a practice exam follows the latest version and reads through the attempt of the current session", async () => {
	const w = await world();
	const exam = await examOf(w, {
		type: "PRACTICE",
		status: "ONGOING",
		scheduledAt: undefined,
		duration: undefined,
		questions: [{ slug: w.q1 }],
	});
	const slotOf = (date: Date) => Math.floor(date.getTime() / 1000);
	const twoDaysAgo = new Date(Date.now() - 48 * 60 * MINUTE);

	await test.step("a new version replaces the old one in the next grant", async () => {
		await start(w, exam);
		const first = granted(await grantOf(w, exam));
		expect(first).toMatchObject({ view: "answer", answering: true });
		expect(first.questions[0]?.dataId).toBe(await dataIdOf(w, w.q1, "v1"));

		await push(w, w.q1, "v2");
		const second = granted(await grantOf(w, exam));
		expect(second.questions[0]?.dataId).toBe(await dataIdOf(w, w.q1, "v2"));
		expect(await frozenAtOf(exam)).toBeNull();
	});

	await test.step("the newest attempt in the window wins over an old one", async () => {
		await prisma.response.create({
			data: {
				publicId: tag("r"),
				authorId: w.classmate.username,
				examId: exam.id,
				slotKey: slotOf(twoDaysAgo),
				acceptingSubmissions: false,
				closedAt: twoDaysAgo,
			},
		});
		const current = await start(w, exam, w.classmate);

		expect(await grantOf(w, exam, w.classmate)).toMatchObject({
			responseId: current.id,
			answering: true,
		});
	});

	await test.step("an attempt outside the window grants nothing", async () => {
		const third = await enroll(w.course.id);
		await prisma.response.create({
			data: {
				publicId: tag("r"),
				authorId: third.username,
				examId: exam.id,
				slotKey: slotOf(twoDaysAgo),
				acceptingSubmissions: false,
				closedAt: twoDaysAgo,
			},
		});

		expect(await grantOf(w, exam, third)).toBeNull();
	});
});

test("a version reads only through the exam that holds it", async () => {
	const w = await world();
	const other = await question(w.course.id);
	await push(w, w.q1, "v2");
	const quiz = await examOf(w, {
		type: "QUIZ",
		questions: [{ slug: w.q1, version: "v1" }],
	});
	await start(w, quiz);
	await db.response.finish(
		{ course: w.course.id, exam: quiz.slug },
		actorOf(w.student),
	);
	await prisma.exam.update({
		where: { id: quiz.id },
		data: { scheduledAt: fromNow(-3 * 60) },
	});
	const final = await examOf(w, {
		scheduledAt: fromNow(24 * 60),
		questions: [{ slug: w.q1, version: "v2" }],
	});
	const student = who(w.student);

	const quizGrant = granted(await grantOf(w, quiz));
	const v1 = await dataIdOf(w, w.q1, "v1");
	expect(quizGrant.questions.map((q) => q.dataId)).toEqual([v1]);
	const read = await grantedQuestions(prisma, quizGrant, student);
	expect(JSON.stringify(read)).toContain(`${w.q1} stem v1`);
	const document = await grantedDocument(prisma, quizGrant, student, w.q1);
	expect(JSON.stringify(document)).toContain(`${w.q1} stem v1`);
	expect(JSON.stringify(document)).toContain('"score"');
	await expect(
		grantedDocument(prisma, quizGrant, student, other),
	).rejects.toMatchObject({ resource: "question" });
	await expect(
		grantedDocument(prisma, quizGrant, student, other),
	).rejects.toBeInstanceOf(NotFound);

	expect(await grantOf(w, final)).toBeNull();

	await prisma.exam.update({
		where: { id: final.id },
		data: { scheduledAt: fromNow(-10) },
	});
	await start(w, final);
	const finalGrant = granted(await grantOf(w, final));
	const v2 = await dataIdOf(w, w.q1, "v2");
	expect(finalGrant.questions.map((q) => q.dataId)).toEqual([v2]);
	expect(v2).not.toBe(v1);
});

test("a question whose pinned version does not exist is left out, not replaced by the latest", async () => {
	const w = await world();
	const exam = await examOf(w, { questions: [] });
	const refs = await prisma.questionRef.findMany({
		where: { courseId: w.course.id, slug: { in: [w.q1, w.q2] } },
	});
	const refOf = (slug: string) => {
		const ref = refs.find((r) => r.slug === slug);
		if (!ref) throw new Error(`no ref for ${slug}`);
		return ref.id;
	};
	await prisma.questionsForExam.createMany({
		data: [
			{
				examId: exam.id,
				questionRefId: refOf(w.q1),
				position: 0,
				version: "v9",
			},
			{
				examId: exam.id,
				questionRefId: refOf(w.q2),
				position: 1,
				version: "v1",
			},
		],
	});
	await start(w, exam);

	const grant = granted(await grantOf(w, exam));
	expect(slugsOf([...grant.questions])).toEqual([w.q2]);
	expect(
		slugsOf(await grantedQuestions(prisma, grant, who(w.student))),
	).toEqual([w.q2]);
});

test("an exam from before the freezing is frozen when a grant is issued for it", async () => {
	const w = await world();
	const exam = await examOf(w, { questions: [{ slug: w.q1 }] });
	await rawAttempt(w, exam);
	expect(await frozenAtOf(exam)).toBeNull();
	expect(await pinsOf(exam)).toEqual([null]);
	const v1 = await dataIdOf(w, w.q1, "v1");

	const first = granted(await grantOf(w, exam));
	expect(first.questions[0]?.dataId).toBe(v1);
	expect(await pinsOf(exam)).toEqual(["v1"]);
	expect(await frozenAtOf(exam)).not.toBeNull();

	await push(w, w.q1, "v2");
	const second = granted(await grantOf(w, exam));
	expect(second.questions[0]?.dataId).toBe(v1);
});

test("a grant is valid for 60 s, only for the actor it was issued to", async () => {
	const w = await world();
	const exam = await examOf(w);
	await start(w, exam);
	const student = who(w.student);

	const t = new Date();
	const grant = granted(await grantOf(w, exam, w.student, t));
	expect(() =>
		assertExamGrant(grant, student, new Date(t.getTime() + 59_999)),
	).not.toThrow();
	expect(() =>
		assertExamGrant(grant, student, new Date(t.getTime() + 60_000)),
	).toThrow(ImproperBehavior);
	expect(() => assertExamGrant(grant, who(w.classmate), t)).toThrow(
		ImproperBehavior,
	);
	expect(() => assertExamGrant(grant, SYSTEM, t)).toThrow(ImproperBehavior);

	const stale = granted(
		await grantOf(w, exam, w.student, new Date(Date.now() - 61_000)),
	);
	await expect(grantedQuestions(prisma, stale, student)).rejects.toBeInstanceOf(
		ImproperBehavior,
	);
});

test("only a grant issued by the module is accepted: copies, literals and mutations are refused", async () => {
	const w = await world();
	const exam = await examOf(w);
	const second = await examOf(w);
	await start(w, exam);
	const student = who(w.student);
	const g = granted(await grantOf(w, exam));
	const original = slugsOf([...g.questions]);

	const forged: [string, ExamGrant][] = [
		["spread", { ...g }],
		["structuredClone", structuredClone(g)],
		["Object.assign", Object.assign({}, g)],
		[
			"literal",
			{
				username: g.username,
				courseId: g.courseId,
				examId: g.examId,
				responseId: g.responseId,
				view: g.view,
				answering: g.answering,
				questions: g.questions.map((q) => ({ ...q })),
				expiresAt: new Date(Date.now() + 60_000),
			} as unknown as ExamGrant,
		],
	];
	for (const [name, copy] of forged) {
		expect(() => assertExamGrant(copy, student), name).toThrow(
			ImproperBehavior,
		);
		await expect(
			grantedQuestions(prisma, copy, student),
			name,
		).rejects.toBeInstanceOf(ImproperBehavior);
		await expect(
			grantedDocument(prisma, copy, student, w.q1),
			name,
		).rejects.toBeInstanceOf(ImproperBehavior);
	}

	const mutable = g as unknown as {
		examId: unknown;
		questions: { dataId: unknown }[];
	};
	expect(() => {
		mutable.examId = second.id;
	}).toThrow(TypeError);
	expect(() => {
		mutable.questions.push({ dataId: 0 });
	}).toThrow(TypeError);
	expect(() => {
		const first = mutable.questions[0];
		if (first) first.dataId = 0;
	}).toThrow(TypeError);

	expect(slugsOf(await grantedQuestions(prisma, g, student))).toEqual(original);
});

test("the grant of many exams agrees with the single grant, and writes nothing", async () => {
	const w = await world();
	const open = await examOf(w);
	await start(w, open);
	const future = await examOf(w, { scheduledAt: fromNow(24 * 60) });
	const released = await examOf(w);
	await start(w, released);
	await db.response.finish(
		{ course: w.course.id, exam: released.slug },
		actorOf(w.student),
	);
	await db.exam.close(pkOf(w, released), actorOf(w.instructor));
	await db.exam.releaseGrades(pkOf(w, released), actorOf(w.instructor));
	const old = await examOf(w, { questions: [{ slug: w.q1 }] });
	await rawAttempt(w, old);

	const views = await grantViews(
		prisma,
		[open.id, future.id, released.id, old.id],
		who(w.student),
	);

	expect([open, future, released, old].map((e) => views.get(e.id))).toEqual([
		"answer",
		null,
		"review",
		"answer",
	]);
	expect(await frozenAtOf(old)).toBeNull();
	expect(await pinsOf(old)).toEqual([null]);
});
