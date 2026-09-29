import { expect, test } from "@playwright/test";
import { type Actor, FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { db, PRACTICE_SESSION_WINDOW_MS, type schema, type User } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";

// Random suffix, not an incrementing counter: this file's own edition slug
// would otherwise collide with the ones sibling spec files draw, since they
// all share one test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2091-1"): Promise<string> {
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

async function makeQuestion(courseId: schema.CourseId) {
	return persistedQuestionFactory.create({ course: courseId, slug: tag("q-") });
}

async function makeExam(
	courseId: schema.CourseId,
	questionSlugs: string[],
	overrides: {
		status?: "DRAFT" | "SCHEDULED" | "ONGOING" | "COMPLETED" | "ARCHIVED";
		type?: "PRACTICE" | "QUIZ" | "EXAM";
	} = {},
) {
	return persistedExamFactory.create({
		course: courseId,
		slug: tag("exam-"),
		status: overrides.status ?? "ONGOING",
		type: overrides.type ?? "EXAM",
		questions: questionSlugs.map((slug) => ({ slug })),
	});
}

//
// Happy path / acceptance criterion 1 and R10
//

test("submit() against two questions of an ongoing exam ends with one response holding two submissions; re-answering the first appends a third", async () => {
	const { course, instructor } = await makeCourse();
	const student = await enrollStudent(course.id);
	const q1 = await makeQuestion(course.id);
	const q2 = await makeQuestion(course.id);
	const exam = await makeExam(course.id, [q1.slug, q2.slug]);

	const afterFirst = await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: q1.slug,
			payload: { answer: "q1-first" },
		},
		{ actor: student },
	);

	const afterSecond = await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: q2.slug,
			payload: { answer: "q2" },
		},
		{ actor: student },
	);

	expect(afterSecond.id).toBe(afterFirst.id);
	expect(afterSecond.publicId).toBe(afterFirst.publicId);
	expect(afterSecond.courseId).toBe(course.id);
	expect(afterSecond.examId).not.toBeNull();
	expect(afterSecond.exam).toBe(exam.slug);
	expect(afterSecond.author).toBe(student.username);
	expect(afterSecond.acceptingSubmissions).toBe(true);
	expect(afterSecond.practiceSession).toBeNull();
	expect(afterSecond.submissions).toHaveLength(2);

	// R10: answering q1 again appends a third submission, it does not replace
	// the first one.
	const afterThird = await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: q1.slug,
			payload: { answer: "q1-second" },
		},
		{ actor: student },
	);

	expect(afterThird.id).toBe(afterFirst.id);
	expect(afterThird.submissions).toHaveLength(3);
	expect(afterThird.submissions.map((s) => s.payload)).toEqual([
		{ answer: "q1-first" },
		{ answer: "q2" },
		{ answer: "q1-second" },
	]);
	expect(
		afterThird.submissions.filter((s) => s.questionId === q1.id),
	).toHaveLength(2);

	// The instructor sees the same attempt with every submission.
	const asInstructor = await db.response.findOne(
		{ publicId: afterThird.publicId },
		{ actor: instructor },
	);
	expect(asInstructor?.submissions).toHaveLength(3);
});

//
// R1 — slotKey 0 for a graded exam, a timestamp for practice; naming
// practiceSession on a graded exam is refused. The unique index is worth a
// direct test too: create() always inserts, so a second call collides.
//

test("create() against a graded exam leaves practiceSession null; against a practice exam it is a timestamp", async () => {
	const { course } = await makeCourse();
	const student = await enrollStudent(course.id);
	const gradedExam = await makeExam(course.id, [], { type: "EXAM" });

	const graded = await db.response.create(
		{ course: course.id, exam: gradedExam.slug, author: student.username },
		{ actor: student },
	);
	expect(graded.examId).not.toBeNull();
	expect(graded.exam).toBe(gradedExam.slug);
	expect(graded.practiceSession).toBeNull();

	const practiceExam = await makeExam(course.id, [], {
		type: "PRACTICE",
		status: "ONGOING",
	});
	const before = Date.now();
	const practice = await db.response.create(
		{
			course: course.id,
			exam: practiceExam.slug,
			author: student.username,
		},
		{ actor: student },
	);
	expect(practice.exam).toBe(practiceExam.slug);
	expect(practice.practiceSession).not.toBeNull();
	// slotKey stores the session start as whole unix seconds, so the derived
	// practiceSession loses sub-second precision — allow a small tolerance
	// rather than asserting millisecond equality.
	expect(practice.practiceSession?.getTime()).toBeGreaterThanOrEqual(
		before - 1000,
	);
});

test("create() refuses a practiceSession named against a graded exam", async () => {
	const { course } = await makeCourse();
	const student = await enrollStudent(course.id);
	const gradedExam = await makeExam(course.id, [], { type: "EXAM" });

	await expect(
		db.response.create(
			{
				course: course.id,
				exam: gradedExam.slug,
				author: student.username,
				practiceSession: new Date(),
			},
			{ actor: student },
		),
	).rejects.toBeInstanceOf(InvalidData);
});

test("create() against the same graded exam twice collides with the unique (authorId, examId, slotKey) index", async () => {
	const { course } = await makeCourse();
	const student = await enrollStudent(course.id);
	const exam = await makeExam(course.id, [], { type: "EXAM" });

	await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		{ actor: student },
	);

	await expect(
		db.response.create(
			{ course: course.id, exam: exam.slug, author: student.username },
			{ actor: student },
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(
		await prisma.response.count({
			where: { authorId: student.username, examId: exam.id },
		}),
	).toBe(1);
});

//
// R3 — the author must hold an ACTIVE enrollment in the exam's course.
//

test("create() refuses an author with no ACTIVE enrollment in the exam's course", async () => {
	const { course } = await makeCourse();
	const exam = await makeExam(course.id, [], { type: "EXAM" });
	const notEnrolled = await persistedUserFactory.create({ role: "STUDENT" });

	await expect(
		db.response.create(
			{ course: course.id, exam: exam.slug, author: notEnrolled.username },
			FULL_ACCESS,
		),
	).rejects.toBeInstanceOf(InvalidData);

	expect(
		await prisma.response.count({ where: { authorId: notEnrolled.username } }),
	).toBe(0);
});

//
// Missing / invisible exam — a nonexistent exam and one the actor cannot see
// (DRAFT or ARCHIVED, not its author) are both NotFound, indistinguishably.
//

test("create() refuses a response naming a missing course or exam", async () => {
	const { course } = await makeCourse();
	const student = await enrollStudent(course.id);

	await expect(
		db.response.create(
			{
				course: 999_999 as schema.CourseId,
				exam: "no-such-exam",
				author: student.username,
			},
			FULL_ACCESS,
		),
	).rejects.toBeInstanceOf(NotFound);

	await expect(
		db.response.create(
			{ course: course.id, exam: "no-such-exam", author: student.username },
			{ actor: student },
		),
	).rejects.toBeInstanceOf(NotFound);
});

for (const status of ["DRAFT", "ARCHIVED"] as const) {
	test(`create() is NotFound for a ${status} exam the student cannot see, same as a missing one`, async () => {
		const { course } = await makeCourse();
		const student = await enrollStudent(course.id);
		const hiddenExam = await makeExam(course.id, [], { status });

		const hidden = db.response.create(
			{
				course: course.id,
				exam: hiddenExam.slug,
				author: student.username,
			},
			{ actor: student },
		);
		const missing = db.response.create(
			{
				course: course.id,
				exam: "no-such-exam",
				author: student.username,
			},
			{ actor: student },
		);

		await expect(hidden).rejects.toBeInstanceOf(NotFound);
		await expect(missing).rejects.toBeInstanceOf(NotFound);

		const [hiddenError, missingError] = await Promise.all([
			hidden.catch((error) => error),
			missing.catch((error) => error),
		]);
		expect(hiddenError).toMatchObject({
			status: missingError.status,
			code: missingError.code,
		});
	});
}

//
// R7 — the 12h practice reuse window (inclusive), table-driven over a
// backdated timestamp; a graded exam always resolves the single slotKey=0
// attempt no matter how far apart the calls are.
//

// slotKey stores the session start as whole unix seconds, not a millisecond
// Date, so the boundary is only meaningful at second resolution.
const WINDOW_S = PRACTICE_SESSION_WINDOW_MS / 1000;

const practiceWindowCases: {
	label: string;
	secondsAgo: number;
	reused: boolean;
}[] = [
	{ label: "1h ago: well inside the window", secondsAgo: 3600, reused: true },
	{
		label: "13h ago: well outside the window",
		secondsAgo: 13 * 3600,
		reused: false,
	},
	// The exact instant is not a promise worth pinning: whether the boundary
	// compares as `<=` or `<` is an implementation detail, and a test that can
	// only pass when the backdating and the reuse check land in the same
	// wall-clock second is racy under load (see the full-suite run). A few
	// seconds' margin on either side still proves the window itself, without
	// depending on that tie.
	{
		label: "a few seconds under 12h: just inside the window",
		secondsAgo: WINDOW_S - 5,
		reused: true,
	},
	{
		label: "a few seconds over 12h: just outside the window",
		secondsAgo: WINDOW_S + 5,
		reused: false,
	},
];

for (const { label, secondsAgo, reused } of practiceWindowCases) {
	test(`submit() against a practice exam, ${label}, ${reused ? "reuses" : "opens a new"} response`, async () => {
		const { course } = await makeCourse();
		const student = await enrollStudent(course.id);
		const question = await makeQuestion(course.id);
		const exam = await makeExam(course.id, [question.slug], {
			type: "PRACTICE",
		});

		const first = await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: question.slug,
				payload: { answer: "first" },
			},
			{ actor: student },
		);

		const backdatedSlotKey = Math.floor(Date.now() / 1000) - secondsAgo;
		await prisma.response.update({
			where: { id: first.id },
			data: { slotKey: backdatedSlotKey },
		});

		const second = await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: question.slug,
				payload: { answer: "second" },
			},
			{ actor: student },
		);

		if (reused) {
			expect(second.id).toBe(first.id);
			expect(second.submissions).toHaveLength(2);
			// R7 only says the newest attempt is reused, not that its
			// timestamp moves — the backdated slotKey stands.
			expect(second.practiceSession).toEqual(new Date(backdatedSlotKey * 1000));
		} else {
			expect(second.id).not.toBe(first.id);
			expect(second.submissions).toHaveLength(1);
			expect(
				await prisma.response.count({
					where: { authorId: student.username, examId: exam.id },
				}),
			).toBe(2);
		}
	});
}

test("submit() against a graded exam always resolves the single slotKey=0 attempt, however far apart the calls are", async () => {
	const { course } = await makeCourse();
	const student = await enrollStudent(course.id);
	const question = await makeQuestion(course.id);
	const exam = await makeExam(course.id, [question.slug], { type: "EXAM" });

	const first = await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: question.slug,
			payload: { answer: "first" },
		},
		{ actor: student },
	);

	// Backdating updatedAt/createdAt is irrelevant to a graded exam: there is
	// only one slot (slotKey 0), so nothing to reuse-vs-open a choice over.
	await prisma.response.update({
		where: { id: first.id },
		data: { createdAt: new Date(Date.now() - 13 * 3600 * 1000) },
	});

	const second = await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: question.slug,
			payload: { answer: "second" },
		},
		{ actor: student },
	);

	expect(second.id).toBe(first.id);
	expect(second.submissions).toHaveLength(2);
	expect(
		await prisma.response.count({
			where: { authorId: student.username, examId: exam.id },
		}),
	).toBe(1);
});

//
// R8 — a response the actor may not read is NotFound, not NotAllowed.
// Access control matrix: {author, peer, owning instructor, other instructor, admin, SYSTEM} x {read, update, delete}.
//

async function makeMatrixFixtures() {
	const { course, instructor } = await makeCourse();
	const author = await enrollStudent(course.id);
	const peer = await enrollStudent(course.id);
	const { instructor: otherInstructor } = await makeCourse();
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const exam = await makeExam(course.id, [], { type: "EXAM" });

	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: author.username,
	});

	return { course, instructor, author, peer, otherInstructor, admin, response };
}

test("findOne(): the author and the owning instructor read the response; a peer, another instructor, and a non-owning admin get null, not an error", async () => {
	const { instructor, author, peer, otherInstructor, admin, response } =
		await makeMatrixFixtures();

	for (const actor of [author, instructor, SYSTEM] as Actor[]) {
		const found = await db.response.findOne(
			{ publicId: response.publicId },
			{ actor },
		);
		expect(found?.publicId).toBe(response.publicId);
	}

	for (const actor of [peer, otherInstructor, admin]) {
		expect(
			await db.response.findOne({ publicId: response.publicId }, { actor }),
		).toBeNull();
	}
});

test("update()/delete(): the author may read but not write, so gets NotAllowed; a peer, another instructor, and a non-owning admin cannot even read, so get NotFound", async () => {
	const { author, peer, otherInstructor, admin, response } =
		await makeMatrixFixtures();

	await expect(
		db.response.update(
			{ publicId: response.publicId },
			{ acceptingSubmissions: false },
			{ actor: author },
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.response.delete({ publicId: response.publicId }, { actor: author }),
	).rejects.toBeInstanceOf(NotAllowed);

	for (const actor of [peer, otherInstructor, admin]) {
		await expect(
			db.response.update(
				{ publicId: response.publicId },
				{ acceptingSubmissions: false },
				{ actor },
			),
		).rejects.toBeInstanceOf(NotFound);
		await expect(
			db.response.delete({ publicId: response.publicId }, { actor }),
		).rejects.toBeInstanceOf(NotFound);
	}

	// The row survived every rejected attempt.
	expect(
		(await prisma.response.findUniqueOrThrow({ where: { id: response.id } }))
			.acceptingSubmissions,
	).toBe(true);
});

test("update()/delete(): the owning instructor and SYSTEM may write the response", async () => {
	const { instructor, response } = await makeMatrixFixtures();

	const updated = await db.response.update(
		{ publicId: response.publicId },
		{ acceptingSubmissions: false },
		{ actor: instructor },
	);
	expect(updated.acceptingSubmissions).toBe(false);

	await db.response.delete({ publicId: response.publicId }, FULL_ACCESS);
	expect(
		await prisma.response.findUnique({ where: { id: response.id } }),
	).toBeNull();
});

//
// R9 — findMany narrows a student to their own rows; an author filter naming
// somebody else is refused, not quietly emptied.
//

test("findMany(): a student is narrowed to their own responses; naming another author is refused; an instructor of another course is refused outright; a non-owning admin sees none", async () => {
	const { course, instructor, author, peer, otherInstructor, admin } =
		await makeMatrixFixtures();

	const ownRows = await db.response.findMany(
		{ course: course.id },
		{ actor: peer },
	);
	expect(ownRows).toHaveLength(0);

	await expect(
		db.response.findMany(
			{ course: course.id, author: author.username },
			{ actor: peer },
		),
	).rejects.toBeInstanceOf(NotAllowed);

	await expect(
		db.response.findMany({ course: course.id }, { actor: otherInstructor }),
	).rejects.toBeInstanceOf(NotAllowed);

	const asAdmin = await db.response.findMany(
		{ course: course.id },
		{ actor: admin },
	);
	expect(asAdmin).toHaveLength(0);

	const asAuthor = await db.response.findMany(
		{ course: course.id },
		{ actor: author },
	);
	expect(asAuthor).toHaveLength(1);

	const asInstructor = await db.response.findMany(
		{ course: course.id },
		{ actor: instructor },
	);
	expect(asInstructor).toHaveLength(1);
});

//
// upsert() and the exam phase
//

for (const status of ["SCHEDULED", "COMPLETED"] as const) {
	test(`upsert() refuses a student an attempt on a ${status} exam and leaves no row behind`, async () => {
		const { course } = await makeCourse();
		const student = await enrollStudent(course.id);
		const exam = await makeExam(course.id, [], { status });

		await expect(
			db.response.upsert(
				{ course: course.id, exam: exam.slug, author: student.username },
				{ actor: student },
			),
		).rejects.toBeInstanceOf(InvalidData);

		const rows = await prisma.response.count({
			where: { authorId: student.username },
		});
		expect(rows).toBe(0);
	});

	test(`upsert() lets the owning instructor open a student's attempt on a ${status} exam`, async () => {
		const { course, instructor } = await makeCourse();
		const student = await enrollStudent(course.id);
		const exam = await makeExam(course.id, [], { status });

		const response = await db.response.upsert(
			{ course: course.id, exam: exam.slug, author: student.username },
			{ actor: instructor },
		);
		expect(response.author).toBe(student.username);
	});
}
