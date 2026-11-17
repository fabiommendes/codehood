import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedOpenExam } from "@/fixtures/exam.factory";
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

test("a student sees the preamble and the questions once the exam opened for them, and after it closed", async () => {
	for (const scheduledAt of [fromNow(-10), fromNow(-5 * 60)]) {
		const w = await world(scheduledAt);
		for (const exam of await readsOf(w, w.student)) {
			expect(exam?.preamble).toBe(PREAMBLE);
			expect(slugsOf(exam)).toEqual(w.slugs);
		}
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
