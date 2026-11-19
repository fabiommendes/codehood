import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db, type Response, type schema } from "@/db";
import { prisma } from "@/db/client";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { sumCode } from "@/mdq/fixtures";
import { examResult, resultPolicy } from "@/services/exam-result";
import { countingAnswers } from "@/services/grading";
import {
	actorOf,
	enroll,
	makeCourse,
	makeExam,
	makeQuestion,
	tag,
} from "./conditional-write-exam-support";

// A listing of attempts carries, per question, only the submissions that
// count: every send, the newest one, the student's newest when the instructor
// wrote the newest, and the ones under a regrade request. The whole history of
// an attempt is read with `findOne`.

const T0 = new Date("2026-03-02T12:00:00.000Z").getTime();

/// A moment `minutes` after the first one, so each row has a known place in time.
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

/// A course with an ongoing exam on `count` essay questions and one student's open attempt.
async function setup(count = 1) {
	const { course, instructor } = await makeCourse();
	const questions = [];
	for (let i = 0; i < count; i++) questions.push(await makeQuestion(course.id));
	const exam = await makeExam(course.id, {
		questions: questions.map(({ slug }) => ({ slug })),
	});
	const student = await enroll(course.id);
	const response = await openAttempt(course.id, exam.slug, student.username);
	return { course, instructor, exam, questions, student, response };
}

function openAttempt(course: schema.CourseId, exam: string, author: string) {
	return persistedResponseFactory.create({ course, exam, author });
}

/// Writes one submission row as it would be stored, at a chosen time.
function store(
	response: Pick<Response, "id">,
	questionId: schema.QuestionRefId,
	payload: string,
	createdAt: Date,
	fields: {
		kind?: "AUTOSAVE" | "SUBMIT" | "FINAL";
		createdById?: string;
	} = {},
) {
	return prisma.submission.create({
		data: {
			publicId: tag("sub-"),
			responseId: response.id,
			questionId,
			payload,
			createdAt,
			kind: fields.kind ?? "AUTOSAVE",
			...(fields.createdById
				? { createdById: fields.createdById, status: "GRADED_MANUALLY" }
				: {}),
		},
	});
}

/// The attempts of the exam as the instructor lists them.
function listed(ctx: {
	course: { id: schema.CourseId };
	exam: { slug: string };
	instructor: Parameters<typeof actorOf>[0];
}) {
	return db.response.findMany(
		{ course: ctx.course.id, exam: ctx.exam.slug },
		actorOf(ctx.instructor),
	);
}

const payloads = (response: Response | undefined) =>
	response?.submissions.map((submission) => submission.payload);

test("findMany(): a question autosaved several times is listed with its newest autosave only", async () => {
	const ctx = await setup(2);
	const [q1, q2] = ctx.questions.map((question) => question.id) as [
		schema.QuestionRefId,
		schema.QuestionRefId,
	];
	await store(ctx.response, q1, "q1-first", at(1));
	await store(ctx.response, q2, "q2-first", at(2));
	await store(ctx.response, q1, "q1-second", at(3));
	await store(ctx.response, q2, "q2-second", at(4));
	await store(ctx.response, q1, "q1-third", at(5));

	const rows = await listed(ctx);

	expect(rows).toHaveLength(1);
	expect(payloads(rows[0])).toEqual(["q2-second", "q1-third"]);
});

test("findMany(): the newest autosave is the one with the greatest createdAt, even when it was stored first", async () => {
	const ctx = await setup();
	const q = ctx.questions[0]?.id as schema.QuestionRefId;
	await store(ctx.response, q, "latest", at(9));
	await store(ctx.response, q, "earlier", at(1));
	await store(ctx.response, q, "middle", at(5));

	const rows = await listed(ctx);

	expect(payloads(rows[0])).toEqual(["latest"]);
});

test("findMany(): every send of a code question is listed, along with the newest autosave", async () => {
	const { course, instructor } = await makeCourse();
	const slug = tag("q-");
	await db.question.create(
		{
			course: course.id,
			slug,
			status: "PUBLISHED",
			version: "1",
			question: sumCode,
		},
		FULL_ACCESS,
	);
	const ref = await prisma.questionRef.findFirstOrThrow({
		where: { courseId: course.id, slug },
	});
	const exam = await makeExam(course.id, { questions: [{ slug }] });
	const student = await enroll(course.id);
	const response = await openAttempt(course.id, exam.slug, student.username);
	await store(response, ref.id, "draft 1", at(1));
	await store(response, ref.id, "send 1", at(2), { kind: "SUBMIT" });
	await store(response, ref.id, "draft 2", at(3));
	await store(response, ref.id, "send 2", at(4), { kind: "SUBMIT" });
	await store(response, ref.id, "draft 3", at(5));
	await store(response, ref.id, "draft 4", at(6));

	const rows = await listed({ course, exam, instructor });

	expect(payloads(rows[0])).toEqual(["send 1", "send 2", "draft 4"]);
	expect(rows[0]?.submissions.map((submission) => submission.kind)).toEqual([
		"SUBMIT",
		"SUBMIT",
		"AUTOSAVE",
	]);
});

test("findMany(): a FINAL send is listed with the earlier SUBMIT ones, and no autosave older than it", async () => {
	const ctx = await setup();
	const q = ctx.questions[0]?.id as schema.QuestionRefId;
	await store(ctx.response, q, "send 1", at(1), { kind: "SUBMIT" });
	await store(ctx.response, q, "draft 1", at(2));
	await store(ctx.response, q, "draft 2", at(3));
	await store(ctx.response, q, "final", at(4), { kind: "FINAL" });

	const rows = await listed(ctx);

	expect(payloads(rows[0])).toEqual(["send 1", "final"]);
});

test("findMany(): among autosaves with the same createdAt, the one with the greater id is listed", async () => {
	const ctx = await setup(2);
	const [q1, q2] = ctx.questions.map((question) => question.id) as [
		schema.QuestionRefId,
		schema.QuestionRefId,
	];
	const sameTime = at(1);
	await store(ctx.response, q1, "q1-low-id", sameTime);
	await store(ctx.response, q2, "q2-low-id", sameTime);
	await store(ctx.response, q1, "q1-mid-id", sameTime);
	const q2Kept = await store(ctx.response, q2, "q2-high-id", sameTime);
	const q1Kept = await store(ctx.response, q1, "q1-high-id", sameTime);

	const rows = await listed(ctx);

	// Both survivors share the timestamp, so the id also decides their order.
	expect(rows[0]?.submissions.map((submission) => submission.id)).toEqual([
		q2Kept.id,
		q1Kept.id,
	]);
	expect(payloads(rows[0])).toEqual(["q2-high-id", "q1-high-id"]);
});

test("findMany(): when the instructor created the newest submission of a question, the student's newest one is listed too", async () => {
	const ctx = await setup();
	const q = ctx.questions[0]?.id as schema.QuestionRefId;
	await store(ctx.response, q, "student-first", at(1));
	await store(ctx.response, q, "student-second", at(2));
	await store(ctx.response, q, "instructor", at(3), {
		createdById: ctx.instructor.username,
	});

	const rows = await listed(ctx);

	expect(payloads(rows[0])).toEqual(["student-second", "instructor"]);
	expect(
		rows[0]?.submissions.map((submission) => submission.createdBy),
	).toEqual([null, ctx.instructor.username]);
});

test("findMany(): an old submission with a regrade request is listed along with the newest one", async () => {
	const ctx = await setup();
	const q = ctx.questions[0]?.id as schema.QuestionRefId;
	const contested = await store(ctx.response, q, "contested", at(1));
	await store(ctx.response, q, "ignored", at(2));
	await store(ctx.response, q, "newest", at(3));
	await prisma.regradeRequest.create({
		data: {
			publicId: tag("rr-"),
			submissionId: contested.id,
			message: "Please look at this answer again.",
		},
	});

	const rows = await listed(ctx);

	expect(payloads(rows[0])).toEqual(["contested", "newest"]);
});

test("findMany(): each attempt of an exam is listed with its own submissions, and an unanswered attempt with none", async () => {
	const ctx = await setup();
	const q = ctx.questions[0]?.id as schema.QuestionRefId;
	const second = await enroll(ctx.course.id);
	const idle = await enroll(ctx.course.id);
	const secondAttempt = await openAttempt(
		ctx.course.id,
		ctx.exam.slug,
		second.username,
	);
	await openAttempt(ctx.course.id, ctx.exam.slug, idle.username);
	await store(ctx.response, q, "first-student-old", at(1));
	await store(secondAttempt, q, "second-student-old", at(2));
	await store(ctx.response, q, "first-student-new", at(3));
	await store(secondAttempt, q, "second-student-new", at(4));

	const rows = await listed(ctx);

	expect(
		Object.fromEntries(rows.map((row) => [row.author, payloads(row)])),
	).toEqual({
		[ctx.student.username]: ["first-student-new"],
		[second.username]: ["second-student-new"],
		[idle.username]: [],
	});
});

test("findOne(): an attempt whose listing is trimmed is read with every submission, oldest first", async () => {
	const ctx = await setup();
	const q = ctx.questions[0]?.id as schema.QuestionRefId;
	await store(ctx.response, q, "first", at(1));
	await store(ctx.response, q, "second", at(2));
	await store(ctx.response, q, "sent", at(3), { kind: "SUBMIT" });
	await store(ctx.response, q, "fourth", at(4));
	await store(ctx.response, q, "fifth", at(5));
	const everything = ["first", "second", "sent", "fourth", "fifth"];

	const byId = await db.response.findOne(
		{ id: ctx.response.id },
		actorOf(ctx.instructor),
	);
	const byPublicId = await db.response.findOne(
		{ publicId: ctx.response.publicId },
		actorOf(ctx.student),
	);

	expect(payloads(byId ?? undefined)).toEqual(everything);
	expect(payloads(byPublicId ?? undefined)).toEqual(everything);
});

test("findMany(): with history set, each attempt is listed with every submission, in the order findOne() gives them", async () => {
	const ctx = await setup(2);
	const [q1, q2] = ctx.questions.map((question) => question.id) as [
		schema.QuestionRefId,
		schema.QuestionRefId,
	];
	await store(ctx.response, q1, "q1-first", at(1));
	await store(ctx.response, q2, "q2-first", at(2));
	await store(ctx.response, q1, "q1-sent", at(3), { kind: "SUBMIT" });
	await store(ctx.response, q1, "q1-third", at(4));
	await store(ctx.response, q2, "q2-second", at(5));
	const filter = { course: ctx.course.id, exam: ctx.exam.slug };

	const withHistory = await db.response.findMany(
		{ ...filter, history: true },
		actorOf(ctx.instructor),
	);
	const withoutHistory = await db.response.findMany(
		{ ...filter, history: false },
		actorOf(ctx.instructor),
	);
	const full = await db.response.findOne(
		{ id: ctx.response.id },
		actorOf(ctx.instructor),
	);

	expect(payloads(withHistory[0])).toEqual([
		"q1-first",
		"q2-first",
		"q1-sent",
		"q1-third",
		"q2-second",
	]);
	expect(withHistory[0]?.submissions).toEqual(full?.submissions);
	expect(payloads(withoutHistory[0])).toEqual([
		"q1-sent",
		"q1-third",
		"q2-second",
	]);
});

test("findMany(): a student lists only their own attempts, the instructor those of every student", async () => {
	const ctx = await setup();
	const q = ctx.questions[0]?.id as schema.QuestionRefId;
	const peer = await enroll(ctx.course.id);
	const peerAttempt = await openAttempt(
		ctx.course.id,
		ctx.exam.slug,
		peer.username,
	);
	await store(ctx.response, q, "mine", at(1));
	await store(peerAttempt, q, "theirs", at(2));

	const own = await db.response.findMany(
		{ course: ctx.course.id },
		actorOf(ctx.student),
	);
	const all = await listed(ctx);

	expect(own.map((row) => row.publicId)).toEqual([ctx.response.publicId]);
	expect(own[0]?.submissions.every((s) => s.payload === "mine")).toBe(true);
	expect(all.map((row) => row.author).sort()).toEqual(
		[ctx.student.username, peer.username].sort(),
	);
});

test("findMany(): every seeded attempt gives the same exam result and counting answers from its listed submissions as from findOne()", async () => {
	// Far enough ahead that every seeded exam with a window has run out.
	const now = new Date("2100-01-01T00:00:00.000Z");
	const courses = await prisma.course.findMany({ select: { id: true } });
	let compared = 0;
	let answered = 0;

	for (const { id } of courses) {
		const course = id as schema.CourseId;
		const exams = await db.exam.findMany({ course }, FULL_ACCESS);
		for (const exam of exams) {
			const [regular, previews, feedback] = await Promise.all([
				db.response.findMany({ course, exam: exam.slug }, FULL_ACCESS),
				db.response.findMany(
					{ course, exam: exam.slug, preview: true },
					FULL_ACCESS,
				),
				db.feedback.findMany({ course, exam: exam.slug }, FULL_ACCESS),
			]);
			const slugs = exam.questions.map((question) => question.slug);
			const policy = resultPolicy(exam.type, {});

			for (const listedAttempt of [...regular, ...previews]) {
				const full = await db.response.findOne(
					{ id: listedAttempt.id },
					FULL_ACCESS,
				);
				if (!full) throw new Error(`attempt ${listedAttempt.id} not found`);
				const where = `${exam.slug} / ${full.author}`;

				expect(
					examResult(
						exam.questions,
						listedAttempt.submissions,
						feedback,
						[],
						policy,
					),
					where,
				).toEqual(
					examResult(exam.questions, full.submissions, feedback, [], policy),
				);

				// Closed, so the attempt counts whatever the exam's window is.
				const counting = (attempt: Response) =>
					countingAnswers(
						exam,
						slugs,
						[{ ...attempt, acceptingSubmissions: false }],
						feedback,
						now,
						new Map(),
						policy,
					);
				expect(counting(listedAttempt), where).toEqual(counting(full));

				compared += 1;
				if (full.submissions.length > 0) answered += 1;
			}
		}
	}

	// The comparison proves nothing on a database with no answered attempt.
	expect(compared).toBeGreaterThan(0);
	expect(answered).toBeGreaterThan(0);
});
