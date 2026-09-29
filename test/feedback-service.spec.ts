import { expect, test } from "@playwright/test";
import { type Actor, FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { db, type schema, type User } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedFeedbackFactory } from "@/fixtures/feedback.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

// Random suffix, not an incrementing counter: this file's own slugs would
// otherwise collide with the ones sibling spec files draw, since they all
// share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2092-2"): Promise<string> {
	if (!(await db.edition.findOne({ slug }, FULL_ACCESS))) {
		await db.edition.create(
			{
				slug,
				name: slug,
				startAt: new Date("2026-01-01"),
				endAt: new Date("2030-12-31"),
			},
			FULL_ACCESS,
		);
	}
	return slug;
}

async function makeCourse(instructor?: User) {
	const owner =
		instructor ?? (await persistedUserFactory.create({ role: "INSTRUCTOR" }));
	const course = await persistedCourseFactory.create({
		instructor: owner.username,
		edition: await ensureEdition(),
	});
	return { course, instructor: owner };
}

async function enrollStudent(courseId: schema.CourseId) {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: courseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

interface ExamOverrides {
	type?: "PRACTICE" | "QUIZ" | "EXAM";
	status?: "DRAFT" | "SCHEDULED" | "ONGOING" | "COMPLETED" | "ARCHIVED";
	scheduledAt?: Date | null;
	duration?: { hours?: number; minutes?: number } | null;
	gradesReleasedAt?: Date | null;
}

/**
 * A full chain, from a fresh course down to a fresh submission, with the
 * exam's release-relevant fields under the caller's control.
 */
async function makeGradedSubmission(overrides: ExamOverrides = {}) {
	const { course, instructor } = await makeCourse();
	const author = await enrollStudent(course.id);
	const question = await persistedQuestionFactory.create({
		course: course.id,
		slug: tag("q-"),
	});
	// Answered first, closed afterwards: a submission is only accepted while
	// the exam is open, so an exam wanted in any other state or schedule gets
	// there the way a real one does, once the work is in.
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: overrides.type ?? "EXAM",
		status: "ONGOING",
		questions: [{ slug: question.slug }],
	});
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: author.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});

	// Straight through `prisma`: `status` moves past what the service allows
	// once answered, and no public schema exposes `gradesReleasedAt` yet.
	const status = overrides.status ?? "ONGOING";
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status,
			...(overrides.scheduledAt !== undefined
				? { scheduledAt: overrides.scheduledAt }
				: {}),
			...(overrides.duration
				? {
						durationMs:
							((overrides.duration.hours ?? 0) * 60 +
								(overrides.duration.minutes ?? 0)) *
							60_000,
					}
				: {}),
			...(overrides.gradesReleasedAt !== undefined
				? { gradesReleasedAt: overrides.gradesReleasedAt }
				: {}),
		},
	});

	return { course, instructor, author, question, exam, submission };
}

//
// Happy path — acceptance criteria 1, 2, 6.
//

test("create() by the instructor and SYSTEM grading as a bot each land under their own ref; findOne/findMany/upsert/update/delete all round-trip", async () => {
	const { course, instructor, author, submission } = await makeGradedSubmission(
		{ type: "PRACTICE" },
	);

	const v1 = await db.feedback.create(
		{
			submission: { id: submission.id },
			ref: "first",
			score: "0.75",
			feedback: "Good",
		},
		{ actor: instructor },
	);
	expect(v1.ref).toBe("first");
	expect(v1.grader).toBe(instructor.username);
	expect(v1.bot).toBeNull();
	expect(v1.score).toBe("0.75");

	// Visible to the instructor and, since the exam is PRACTICE, to the author.
	for (const actor of [instructor, author] as Actor[]) {
		const found = await db.feedback.findOne({ id: v1.id }, { actor });
		expect(found?.id).toBe(v1.id);
	}

	const v2 = await db.feedback.create(
		{
			submission: { id: submission.id },
			ref: "bot-pass",
			score: "1",
			bot: "grading-bot",
		},
		{ actor: SYSTEM },
	);
	expect(v2.ref).toBe("bot-pass");
	expect(v2.grader).toBeNull();
	expect(v2.bot).toBe("grading-bot");

	const bySubmissionAndRef = await db.feedback.findOne(
		{ submission: { id: submission.id }, ref: "bot-pass" },
		{ actor: instructor },
	);
	expect(bySubmissionAndRef?.id).toBe(v2.id);

	const byId = await db.feedback.findOne({ id: v2.id }, { actor: instructor });
	expect(byId?.id).toBe(v2.id);

	const listed = await db.feedback.findMany(
		{ submission: { id: submission.id }, course: course.id },
		{ actor: instructor },
	);
	expect(listed.map((f) => f.id)).toEqual([v1.id, v2.id]);
	// GET .../feedback/bot-pass resolves the row findMany lists second.
	expect(bySubmissionAndRef?.id).toBe(listed[1]?.id);

	const upserted = await db.feedback.upsert(
		{
			submission: { id: submission.id },
			ref: "first",
			score: "0.9",
			feedback: "Revised",
		},
		{ actor: instructor },
	);
	expect(upserted.id).toBe(v1.id);
	expect(upserted.ref).toBe("first");
	expect(upserted.score).toBe("0.9");

	const updated = await db.feedback.update(
		{ id: v2.id },
		{ score: "0.6" },
		{ actor: instructor },
	);
	expect(updated.id).toBe(v2.id);
	expect(updated.score).toBe("0.6");
	// The grader on record never moves on update.
	expect(updated.grader).toBeNull();
	expect(updated.bot).toBe("grading-bot");

	await db.feedback.delete({ id: v2.id }, { actor: instructor });
	expect(await prisma.feedback.findUnique({ where: { id: v2.id } })).toBeNull();
	expect(
		await prisma.feedback.findUnique({ where: { id: v1.id } }),
	).not.toBeNull();
});

//
// persistedFeedbackFactory — provisions the whole chain (course, question,
// exam, response, submission) so the default create satisfies every
// precondition, and honors the transient exam overrides the release matrix
// relies on.
//

test("persistedFeedbackFactory provisions its own submission and its exam honors the transient overrides", async () => {
	const feedback = await persistedFeedbackFactory.create(
		{},
		{
			transient: {
				examType: "PRACTICE",
				examStatus: "ONGOING",
			},
		},
	);
	// The sequence is shared by every file that uses the factory.
	expect(feedback.ref).toMatch(/^pass-\d+$/);

	const submission = await prisma.submission.findUniqueOrThrow({
		where: { id: feedback.submissionId },
		include: { response: { include: { exam: true } } },
	});
	expect(submission.response.exam.type).toBe("PRACTICE");
});

//
// F1/F2 — exactly one of grader/bot; grader defaults to the actor;
// naming a different grader is refused for anyone but SYSTEM.
//

test("create() rejects both grader and bot set, and rejects neither set for SYSTEM", async () => {
	const { instructor, submission } = await makeGradedSubmission();

	await expect(
		db.feedback.create(
			{
				submission: { id: submission.id },
				ref: "pass",
				score: "1",
				grader: instructor.username,
				bot: "bot",
			},
			{ actor: instructor },
		),
	).rejects.toBeInstanceOf(InvalidData);

	await expect(
		db.feedback.create(
			{ submission: { id: submission.id }, ref: "pass", score: "1" },
			{ actor: SYSTEM },
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(
		await prisma.feedback.count({ where: { submissionId: submission.id } }),
	).toBe(0);
});

test("create() defaults grader to a user actor's own username, and refuses naming a different grader unless the actor is SYSTEM", async () => {
	const { instructor, submission } = await makeGradedSubmission();
	const someoneElse = await persistedUserFactory.create({
		role: "INSTRUCTOR",
	});

	const own = await db.feedback.create(
		{ submission: { id: submission.id }, ref: "own", score: "1" },
		{ actor: instructor },
	);
	expect(own.grader).toBe(instructor.username);

	await expect(
		db.feedback.create(
			{
				submission: { id: submission.id },
				ref: "for-another",
				score: "1",
				grader: someoneElse.username,
			},
			{ actor: instructor },
		),
	).rejects.toBeInstanceOf(NotAllowed);

	// SYSTEM may name any grader.
	const onBehalf = await db.feedback.create(
		{
			submission: { id: submission.id },
			ref: "on-behalf",
			score: "1",
			grader: someoneElse.username,
		},
		{ actor: SYSTEM },
	);
	expect(onBehalf.grader).toBe(someoneElse.username);
});

//
// F3 — score is a decimal or n/d fraction, signed, in [-1, 1]; stored as the
// exact string sent.
//

const scoreCases: { score: string; valid: boolean }[] = [
	{ score: "0.5", valid: true },
	{ score: "-0.25", valid: true },
	{ score: "1/3", valid: true },
	{ score: "-2/3", valid: true },
	{ score: "0", valid: true },
	{ score: "1", valid: true },
	{ score: "-1", valid: true },
	{ score: "1.5", valid: false },
	{ score: "-2", valid: false },
	{ score: "2/1", valid: false },
	{ score: "1/0", valid: false },
	{ score: "abc", valid: false },
	{ score: "0.5.1", valid: false },
	{ score: "1 / 3", valid: false },
	{ score: "", valid: false },
];

for (const { score, valid } of scoreCases) {
	test(`create() ${valid ? "accepts" : "rejects"} score ${JSON.stringify(score)}`, async () => {
		const { instructor, submission } = await makeGradedSubmission();

		const attempt = db.feedback.create(
			{ submission: { id: submission.id }, ref: "pass", score },
			{ actor: instructor },
		);

		if (valid) {
			const created = await attempt;
			// Stored and returned as the exact string sent — never renormalized.
			expect(created.score).toBe(score);
			const found = await db.feedback.findOne(
				{ id: created.id },
				{ actor: instructor },
			);
			expect(found?.score).toBe(score);
		} else {
			await expect(attempt).rejects.toBeInstanceOf(InvalidData);
			expect(
				await prisma.feedback.count({
					where: { submissionId: submission.id },
				}),
			).toBe(0);
		}
	});
}

//
// F4 — release, by exam type. Integration-level matrix through db.feedback,
// with generous margins around the QUIZ window so the test is not sensitive
// to the few milliseconds elapsed between building `now` and the service's
// own clock read. The exact boundaries belong to `resultsReleased`, and
// test/exam-state.spec.ts covers them.
//

interface ReleaseCase {
	label: string;
	overrides: ExamOverrides;
	releasedToAuthor: boolean;
}

const releaseCases: ReleaseCase[] = [
	{
		label: "a PRACTICE releases the moment the score is written",
		overrides: { type: "PRACTICE", status: "ONGOING" },
		releasedToAuthor: true,
	},
	{
		label: "a QUIZ whose window has already closed is released",
		overrides: {
			type: "QUIZ",
			status: "ONGOING",
			scheduledAt: new Date(Date.now() - 10 * 60_000),
			duration: { minutes: 5 },
		},
		releasedToAuthor: true,
	},
	{
		label: "a QUIZ whose window has not closed yet is not released",
		overrides: {
			type: "QUIZ",
			status: "ONGOING",
			scheduledAt: new Date(Date.now() - 5 * 60_000),
			duration: { hours: 1 },
		},
		releasedToAuthor: false,
	},
	{
		label:
			"a QUIZ with no scheduledAt falls back to its status: COMPLETED releases",
		overrides: { type: "QUIZ", status: "COMPLETED", scheduledAt: null },
		releasedToAuthor: true,
	},
	{
		label:
			"an untimed QUIZ past its scheduled start is not released until COMPLETED",
		overrides: {
			type: "QUIZ",
			status: "ONGOING",
			scheduledAt: new Date(Date.now() - 10 * 60_000),
		},
		releasedToAuthor: false,
	},
	{
		label:
			"a QUIZ with no scheduledAt falls back to its status: ONGOING does not",
		overrides: { type: "QUIZ", status: "ONGOING", scheduledAt: null },
		releasedToAuthor: false,
	},
	{
		label: "an EXAM with a null gradesReleasedAt is not released",
		overrides: { type: "EXAM", status: "ONGOING", gradesReleasedAt: null },
		releasedToAuthor: false,
	},
	{
		label: "an EXAM with a future gradesReleasedAt is not released",
		overrides: {
			type: "EXAM",
			status: "ONGOING",
			gradesReleasedAt: new Date(Date.now() + 60 * 60_000),
		},
		releasedToAuthor: false,
	},
	{
		label: "an EXAM with a past gradesReleasedAt is released",
		overrides: {
			type: "EXAM",
			status: "ONGOING",
			gradesReleasedAt: new Date(Date.now() - 60 * 60_000),
		},
		releasedToAuthor: true,
	},
];

for (const { label, overrides, releasedToAuthor } of releaseCases) {
	test(`F4 release: ${label}`, async () => {
		const { instructor, author, submission } =
			await makeGradedSubmission(overrides);
		const feedback = await db.feedback.create(
			{ submission: { id: submission.id }, ref: "pass", score: "1" },
			{ actor: instructor },
		);

		// The instructor sees it regardless of release.
		expect(
			(await db.feedback.findOne({ id: feedback.id }, { actor: instructor }))
				?.id,
		).toBe(feedback.id);

		const seenByAuthor = await db.feedback.findOne(
			{ id: feedback.id },
			{ actor: author },
		);
		if (releasedToAuthor) {
			expect(seenByAuthor?.id).toBe(feedback.id);
		} else {
			expect(seenByAuthor).toBeNull();
		}
	});
}

//
// F5/access control — {author, peer, owning instructor, other instructor,
// non-owning admin, SYSTEM} x {findOne, findMany, create, update, upsert, delete}.
//

test("findOne(): the owning instructor and SYSTEM read the feedback at any time; the author reads it once released (PRACTICE); a peer, another instructor and a non-owning admin get null", async () => {
	const { course, instructor, author, submission } = await makeGradedSubmission(
		{ type: "PRACTICE" },
	);
	const peer = await enrollStudent(course.id);
	const { instructor: otherInstructor } = await makeCourse();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });

	const feedback = await db.feedback.create(
		{ submission: { id: submission.id }, ref: "pass", score: "1" },
		{ actor: instructor },
	);

	for (const actor of [instructor, SYSTEM, author] as Actor[]) {
		const found = await db.feedback.findOne({ id: feedback.id }, { actor });
		expect(found?.id).toBe(feedback.id);
	}

	for (const actor of [peer, otherInstructor, admin]) {
		expect(
			await db.feedback.findOne({ id: feedback.id }, { actor }),
		).toBeNull();
	}
});

test("findMany(): a student is narrowed to released feedback on their own submissions; naming another author is refused; an instructor of another course is refused outright; a non-owning admin sees none", async () => {
	const { course, instructor, author, submission } = await makeGradedSubmission(
		{ type: "PRACTICE" },
	);
	const peer = await enrollStudent(course.id);
	const { instructor: otherInstructor } = await makeCourse();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });

	await db.feedback.create(
		{ submission: { id: submission.id }, ref: "pass", score: "1" },
		{ actor: instructor },
	);

	const peerRows = await db.feedback.findMany(
		{ course: course.id },
		{ actor: peer },
	);
	expect(peerRows).toHaveLength(0);

	await expect(
		db.feedback.findMany(
			{ course: course.id, author: author.username },
			{ actor: peer },
		),
	).rejects.toBeInstanceOf(NotAllowed);

	await expect(
		db.feedback.findMany({ course: course.id }, { actor: otherInstructor }),
	).rejects.toBeInstanceOf(NotAllowed);

	const asAdmin = await db.feedback.findMany(
		{ course: course.id },
		{ actor: admin },
	);
	expect(asAdmin).toHaveLength(0);

	const asAuthor = await db.feedback.findMany(
		{ course: course.id },
		{ actor: author },
	);
	expect(asAuthor).toHaveLength(1);

	const asInstructor = await db.feedback.findMany(
		{ course: course.id },
		{ actor: instructor },
	);
	expect(asInstructor).toHaveLength(1);
});

test("create()/update()/upsert()/delete(): the owning instructor and SYSTEM may write; the author may read but not write so gets NotAllowed; a peer, another instructor and a non-owning admin cannot even read so get NotFound", async () => {
	const { course, instructor, author, submission } = await makeGradedSubmission(
		{ type: "PRACTICE" },
	);
	const peer = await enrollStudent(course.id);
	const { instructor: otherInstructor } = await makeCourse();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });

	const feedback = await db.feedback.create(
		{ submission: { id: submission.id }, ref: "pass", score: "1" },
		{ actor: instructor },
	);

	// The author can read (F5) but not write.
	await expect(
		db.feedback.create(
			{ submission: { id: submission.id }, ref: "attempt", score: "0.5" },
			{ actor: author },
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.feedback.update(
			{ id: feedback.id },
			{ score: "0.5" },
			{ actor: author },
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.feedback.upsert(
			{
				submission: { id: submission.id },
				ref: feedback.ref,
				score: "0.5",
			},
			{ actor: author },
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.feedback.delete({ id: feedback.id }, { actor: author }),
	).rejects.toBeInstanceOf(NotAllowed);

	// A peer, another instructor and a non-owning admin cannot even read the
	// submission this feedback grades, so every write is NotFound.
	for (const actor of [peer, otherInstructor, admin]) {
		await expect(
			db.feedback.create(
				{ submission: { id: submission.id }, ref: "attempt", score: "0.5" },
				{ actor },
			),
		).rejects.toBeInstanceOf(NotFound);
		await expect(
			db.feedback.update({ id: feedback.id }, { score: "0.5" }, { actor }),
		).rejects.toBeInstanceOf(NotFound);
		await expect(
			db.feedback.upsert(
				{
					submission: { id: submission.id },
					ref: feedback.ref,
					score: "0.5",
				},
				{ actor },
			),
		).rejects.toBeInstanceOf(NotFound);
		await expect(
			db.feedback.delete({ id: feedback.id }, { actor }),
		).rejects.toBeInstanceOf(NotFound);
	}

	// The owning instructor and SYSTEM may write.
	const revised = await db.feedback.update(
		{ id: feedback.id },
		{ score: "0.5" },
		{ actor: instructor },
	);
	expect(revised.score).toBe("0.5");

	await db.feedback.upsert(
		{
			submission: { id: submission.id },
			ref: feedback.ref,
			score: "0.6",
		},
		{ actor: SYSTEM },
	);

	await db.feedback.delete({ id: feedback.id }, { actor: instructor });
	expect(
		await prisma.feedback.findUnique({ where: { id: feedback.id } }),
	).toBeNull();
});

//
// F8 — submissionId is resolved from `submission`, ignoring anything smuggled
// in the payload; two graders writing different refs never collide.
//

test("create() ignores a smuggled submissionId and always resolves its own submission", async () => {
	const { instructor, submission } = await makeGradedSubmission();
	const { submission: foreignSubmission } = await makeGradedSubmission();

	const smuggled = {
		submission: { id: submission.id },
		ref: "pass",
		score: "1",
		submissionId: foreignSubmission.id,
		// biome-ignore lint/suspicious/noExplicitAny: intentionally smuggled field the create schema does not declare
	} as any;

	const created = await db.feedback.create(smuggled, { actor: instructor });
	expect(created.submissionId).toBe(submission.id);
	expect(created.submissionId).not.toBe(foreignSubmission.id);
});

test("only SYSTEM records a bot's pass: an instructor naming a bot is refused on create and upsert", async () => {
	const { instructor, submission } = await makeGradedSubmission();

	for (const write of [db.feedback.create, db.feedback.upsert]) {
		await expect(
			write.call(
				db.feedback,
				{
					submission: { id: submission.id },
					ref: "as-bot",
					score: "1",
					bot: "grading-bot",
				},
				{ actor: instructor },
			),
		).rejects.toBeInstanceOf(NotAllowed);
	}

	expect(
		await prisma.feedback.count({ where: { submissionId: submission.id } }),
	).toBe(0);
});

test("upsert() over an existing pass still checks who the input names: another grader or a bot is NotAllowed, both is InvalidData, and the pass is left as it was", async () => {
	const { instructor, submission } = await makeGradedSubmission();
	const someoneElse = await persistedUserFactory.create({
		role: "INSTRUCTOR",
	});
	const key = { submission: { id: submission.id }, ref: "pass" };
	await db.feedback.create({ ...key, score: "1" }, { actor: instructor });

	await expect(
		db.feedback.upsert(
			{ ...key, score: "0", grader: someoneElse.username },
			{ actor: instructor },
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.feedback.upsert(
			{ ...key, score: "0", bot: "grading-bot" },
			{ actor: instructor },
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.feedback.upsert(
			{ ...key, score: "0", grader: instructor.username, bot: "grading-bot" },
			{ actor: instructor },
		),
	).rejects.toBeInstanceOf(InvalidData);

	const pass = await db.feedback.findOne(key, { actor: instructor });
	expect(pass?.score).toBe("1");
	expect(pass?.grader).toBe(instructor.username);
});

test("two concurrent graders writing different refs both land", async () => {
	const { instructor, submission } = await makeGradedSubmission();

	const [a, b] = await Promise.all([
		db.feedback.create(
			{ submission: { id: submission.id }, ref: "human", score: "0.4" },
			{ actor: instructor },
		),
		db.feedback.create(
			{
				submission: { id: submission.id },
				ref: "bot",
				score: "0.6",
				bot: "grader-bot",
			},
			{ actor: SYSTEM },
		),
	]);

	expect(new Set([a.ref, b.ref])).toEqual(new Set(["human", "bot"]));
	expect(
		await prisma.feedback.count({ where: { submissionId: submission.id } }),
	).toBe(2);
});

//
// F9 — deleting a submission cascades its feedback; deleting feedback leaves
// the submission standing.
//

test("deleting a submission deletes its feedback; deleting feedback leaves the submission standing", async () => {
	const { instructor, submission } = await makeGradedSubmission();
	const feedback = await db.feedback.create(
		{ submission: { id: submission.id }, ref: "only", score: "1" },
		{ actor: instructor },
	);

	await db.submission.delete({ id: submission.id }, { actor: instructor });
	expect(
		await prisma.feedback.findUnique({ where: { id: feedback.id } }),
	).toBeNull();

	const { instructor: instructor2, submission: submission2 } =
		await makeGradedSubmission();
	const feedback2 = await db.feedback.create(
		{ submission: { id: submission2.id }, ref: "only", score: "1" },
		{ actor: instructor2 },
	);
	await db.feedback.delete({ id: feedback2.id }, { actor: instructor2 });
	expect(
		await prisma.submission.findUnique({ where: { id: submission2.id } }),
	).not.toBeNull();
});

//
// F10 — a ref is unique within its submission, chosen by the writer, and
// freed again when the pass carrying it is deleted.
//

test("a ref is the writer's own: a deleted one is free to reuse, and the rest keep theirs", async () => {
	const { course, instructor, submission } = await makeGradedSubmission();

	for (const [ref, score] of [
		["draft", "0.1"],
		["second-look", "0.2"],
		["final", "0.3"],
	] as const) {
		await db.feedback.create(
			{ submission: { id: submission.id }, ref, score },
			{ actor: instructor },
		);
	}

	const middle = await db.feedback.findOne(
		{ submission: { id: submission.id }, ref: "second-look" },
		{ actor: instructor },
	);
	if (!middle) throw new Error("the pass just written was not found");
	await db.feedback.delete({ id: middle.id }, { actor: instructor });

	const reused = await db.feedback.create(
		{ submission: { id: submission.id }, ref: "second-look", score: "0.4" },
		{ actor: instructor },
	);
	expect(reused.ref).toBe("second-look");

	const refs = (
		await db.feedback.findMany(
			{ submission: { id: submission.id }, course: course.id },
			{ actor: instructor },
		)
	).map((f) => f.ref);
	expect(refs).toEqual(["draft", "final", "second-look"]);
});

test("create() refuses a ref the submission already carries, while upsert() revises it", async () => {
	const { instructor, submission } = await makeGradedSubmission();

	await db.feedback.create(
		{ submission: { id: submission.id }, ref: "only", score: "0.1" },
		{ actor: instructor },
	);

	await expect(
		db.feedback.create(
			{ submission: { id: submission.id }, ref: "only", score: "0.5" },
			{ actor: instructor },
		),
	).rejects.toBeInstanceOf(InvalidData);

	const revised = await db.feedback.upsert(
		{ submission: { id: submission.id }, ref: "only", score: "0.5" },
		{ actor: instructor },
	);
	expect(revised.score).toBe("0.5");

	expect(
		await prisma.feedback.count({ where: { submissionId: submission.id } }),
	).toBe(1);
});

test("the same ref under two different submissions is two separate passes", async () => {
	const first = await makeGradedSubmission();
	const second = await makeGradedSubmission();

	const a = await db.feedback.create(
		{ submission: { id: first.submission.id }, ref: "final", score: "0.1" },
		{ actor: first.instructor },
	);
	const b = await db.feedback.create(
		{ submission: { id: second.submission.id }, ref: "final", score: "0.2" },
		{ actor: second.instructor },
	);
	expect(a.id).not.toBe(b.id);
});
