import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedOpenExam } from "@/fixtures/exam.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import {
	actorOf,
	enroll,
	makeCourse,
	makeQuestion,
	tag,
} from "./conditional-write-exam-support";

const MINUTE = 60_000;

/// `minutes` from the real clock, negative for the past.
const fromNow = (minutes: number) => new Date(Date.now() + minutes * MINUTE);

const PREAMBLE = "Read all the questions before you start.";

/// A course with a student, a classmate and a scheduled exam of two questions that opens at `scheduledAt`.
async function world(scheduledAt: Date) {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course.id);
	const classmate = await enroll(course.id);
	const questions = [
		await makeQuestion(course.id),
		await makeQuestion(course.id),
	];
	const exam = await persistedOpenExam(
		course.id,
		questions.map((q) => q.slug),
		{
			slug: tag("exam-"),
			status: "SCHEDULED",
			type: "EXAM",
			scheduledAt,
			duration: { minutes: 60 },
			description: "Chapters 1 to 3",
			preamble: PREAMBLE,
		},
	);
	return {
		course,
		instructor,
		student,
		classmate,
		exam,
		slugs: questions.map((q) => q.slug).sort(),
	};
}

/// The question slugs of `exam`, sorted.
const slugsOf = (exam: { questions: { slug: string }[] } | null | undefined) =>
	exam?.questions.map((q) => q.slug).sort();

type World = Awaited<ReturnType<typeof world>>;

/// The exam as each read path of the service returns it to `actor`.
async function readsOf(w: World, actor: Parameters<typeof actorOf>[0]) {
	const opts = actorOf(actor);
	const pk = { course: w.course.id, slug: w.exam.slug };
	const one = await db.exam.findOne(pk, opts);
	const many = (await db.exam.findMany({ course: w.course.id }, opts)).find(
		(e) => e.slug === w.exam.slug,
	);
	return [one, many];
}

test("a student sees no preamble and no questions of an exam that has not opened for them, only what the list needs", async () => {
	const w = await world(fromNow(60));

	for (const exam of await readsOf(w, w.student)) {
		expect(exam).toMatchObject({
			title: w.exam.title,
			description: "Chapters 1 to 3",
			type: "EXAM",
			status: "SCHEDULED",
			preamble: null,
			questions: [],
		});
		expect(exam?.scheduledAt).toEqual(w.exam.scheduledAt);
		expect(exam?.duration).toEqual(w.exam.duration);
		expect(JSON.stringify(exam)).not.toContain(PREAMBLE);
		for (const slug of w.slugs) {
			expect(JSON.stringify(exam)).not.toContain(slug);
		}
	}
});

test("a student with a later scheduled exception sees nothing of the exam while the class already has it open", async () => {
	const w = await world(fromNow(-10));
	await db.examException.create(
		{
			course: w.course.id,
			exam: w.exam.slug,
			username: w.student.username,
			extraTime: { minutes: 0 },
			scheduledAt: fromNow(24 * 60),
		},
		FULL_ACCESS,
	);

	for (const exam of await readsOf(w, w.student)) {
		expect(exam).toMatchObject({ preamble: null, questions: [] });
	}
	for (const exam of await readsOf(w, w.classmate)) {
		expect(exam?.preamble).toBe(PREAMBLE);
		expect(slugsOf(exam)).toEqual(w.slugs);
	}
});

/// Opens an attempt of the student of `w` at its exam.
const attempt = (w: World, author = w.student) =>
	persistedResponseFactory.create({
		course: w.course.id,
		exam: w.exam.slug,
		author: author.username,
	});

test("a student sees the preamble of an open exam, and the questions only once they have an attempt", async () => {
	const w = await world(fromNow(-10));

	for (const exam of await readsOf(w, w.student)) {
		expect(exam?.preamble).toBe(PREAMBLE);
		expect(exam?.questions).toEqual([]);
	}

	await attempt(w);

	for (const exam of await readsOf(w, w.student)) {
		expect(exam?.preamble).toBe(PREAMBLE);
		expect(slugsOf(exam)).toEqual(w.slugs);
	}
	for (const exam of await readsOf(w, w.classmate)) {
		expect(exam?.preamble).toBe(PREAMBLE);
		expect(exam?.questions).toEqual([]);
	}
});

test("after the exam closed, a student without an attempt sees the preamble, and the questions only once the grades are released", async () => {
	const w = await world(fromNow(-5 * 60));

	for (const exam of await readsOf(w, w.student)) {
		expect(exam?.preamble).toBe(PREAMBLE);
		expect(exam?.questions).toEqual([]);
	}

	await prisma.exam.update({
		where: { id: w.exam.id },
		data: { gradesReleasedAt: fromNow(-60) },
	});

	for (const exam of await readsOf(w, w.student)) {
		expect(exam?.preamble).toBe(PREAMBLE);
		expect(slugsOf(exam)).toEqual(w.slugs);
	}
});

test("an exception that brings the exam forward opens it for that student only", async () => {
	const w = await world(fromNow(24 * 60));
	await db.examException.create(
		{
			course: w.course.id,
			exam: w.exam.slug,
			username: w.student.username,
			extraTime: { minutes: 0 },
			scheduledAt: fromNow(-10),
		},
		FULL_ACCESS,
	);

	for (const exam of await readsOf(w, w.student)) {
		expect(exam?.preamble).toBe(PREAMBLE);
		expect(exam?.questions).toEqual([]);
	}

	await attempt(w);

	for (const exam of await readsOf(w, w.student)) {
		expect(exam?.preamble).toBe(PREAMBLE);
		expect(slugsOf(exam)).toEqual(w.slugs);
	}
	for (const exam of await readsOf(w, w.classmate)) {
		expect(exam).toMatchObject({ preamble: null, questions: [] });
	}
});

test("the instructor and SYSTEM always see the preamble and the questions", async () => {
	const w = await world(fromNow(60));
	const pk = { course: w.course.id, slug: w.exam.slug };

	const reads = [
		...(await readsOf(w, w.instructor)),
		await db.exam.findOne(pk, FULL_ACCESS),
	];
	for (const exam of reads) {
		expect(exam?.preamble).toBe(PREAMBLE);
		expect(slugsOf(exam)).toEqual(w.slugs);
	}
});

test("a student gets the questions of an exam only with an attempt or a release, and the instructor always", async () => {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course.id);
	const questions = [
		await makeQuestion(course.id),
		await makeQuestion(course.id),
	];
	const slugs = questions.map((q) => q.slug).sort();
	const exam = (fields: Parameters<typeof persistedOpenExam>[2]) =>
		persistedOpenExam(course.id, slugs, {
			slug: tag("exam-"),
			type: "EXAM",
			duration: { minutes: 60 },
			...fields,
		});
	const a = await exam({ scheduledAt: fromNow(-10), preamble: PREAMBLE });
	const b = await exam({ scheduledAt: fromNow(-10) });
	const c = await exam({ scheduledAt: fromNow(-10) });
	const d = await exam({ scheduledAt: fromNow(-10) });
	const e = await exam({ status: "SCHEDULED", scheduledAt: fromNow(24 * 60) });
	await persistedResponseFactory.create({
		course: course.id,
		exam: b.slug,
		author: student.username,
	});
	for (const closed of [c, d]) {
		await db.exam.close(
			{ course: course.id, slug: closed.slug },
			{ actor: instructor },
		);
	}
	await prisma.exam.update({
		where: { id: c.id },
		data: { gradesReleasedAt: fromNow(-1) },
	});

	const byStudent = await db.exam.findMany(
		{ course: course.id },
		actorOf(student),
	);
	const byInstructor = await db.exam.findMany(
		{ course: course.id },
		actorOf(instructor),
	);
	const ofList = (list: typeof byStudent, slug: string) =>
		list.find((x) => x.slug === slug);
	const expected = [
		[a, []],
		[b, slugs],
		[c, slugs],
		[d, []],
		[e, []],
	] as const;

	for (const [created, visible] of expected) {
		const one = await db.exam.findOne(
			{ course: course.id, slug: created.slug },
			actorOf(student),
		);
		expect(slugsOf(ofList(byStudent, created.slug))).toEqual(visible);
		expect(slugsOf(one)).toEqual(visible);
		expect(slugsOf(ofList(byInstructor, created.slug))).toEqual(slugs);
	}
	expect(ofList(byStudent, a.slug)?.preamble).toBe(PREAMBLE);
});
