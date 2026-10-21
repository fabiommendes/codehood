import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import { db, type schema, type User } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { persistedResponseFactory } from "@/fixtures/response.factory";
import { persistedSubmissionFactory } from "@/fixtures/submission.factory";
import { persistedUserFactory } from "@/fixtures/user.factory";
import { examResult, type QuestionOutcome } from "@/services/exam-result";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const MESSAGE = "I disagree with how this answer was graded.";

// Random suffix, not an incrementing counter: slugs would otherwise collide
// with the ones sibling spec files draw from the shared test database.
function tag(prefix: string): string {
	return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureEdition(slug = "2095-2"): Promise<string> {
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

//
// Setup: a course, exams answered by enrolled students, then released
//

async function makeCourse() {
	const instructor = await persistedUserFactory.create({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		edition: await ensureEdition(),
	});
	return { course, instructor };
}

type Course = Awaited<ReturnType<typeof makeCourse>>["course"];

async function enroll(course: Course): Promise<User> {
	const student = await persistedUserFactory.create({ role: "STUDENT" });
	await db.enrollment.create(
		{ course: course.id as schema.CourseId, username: student.username },
		FULL_ACCESS,
	);
	return student;
}

/// An `ONGOING` `EXAM` with one question, still open for answers.
async function makeOpenExam(course: Course) {
	const question = await persistedQuestionFactory.create({
		course: course.id,
		slug: tag("q-"),
	});
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: tag("exam-"),
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: question.slug }],
	});
	return { exam, question };
}

type OpenExam = Awaited<ReturnType<typeof makeOpenExam>>;

/// The student answers the exam's question; `score` grades the answer when given.
async function answer(
	course: Course,
	{ exam, question }: OpenExam,
	student: User,
	grade?: { score: string; grader: string },
) {
	const response = await persistedResponseFactory.create({
		course: course.id,
		exam: exam.slug,
		author: student.username,
	});
	const submission = await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: question.slug,
	});
	if (grade) {
		await db.feedback.create(
			{
				submission: { id: submission.id },
				ref: "first-pass",
				score: grade.score,
				grader: grade.grader,
			},
			FULL_ACCESS,
		);
	}
	return { response, submission };
}

/// Closes the exam and releases its grades `ago` milliseconds in the past.
async function release({ exam }: OpenExam, ago = MINUTE) {
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED", gradesReleasedAt: new Date(Date.now() - ago) },
	});
}

/// One released exam with one graded answer by one enrolled student.
async function makeScenario(score = "0") {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course);
	const open = await makeOpenExam(course);
	const { submission } = await answer(course, open, student, {
		score,
		grader: instructor.username,
	});
	await release(open);
	return { course, instructor, student, open, submission };
}

type Scenario = Awaited<ReturnType<typeof makeScenario>>;

/// Opens a request on the scenario's answer, as its author.
function openRequest({ course, student, submission }: Scenario) {
	return db.regradeRequest.create(
		{ course: course.id, submission: submission.publicId, message: MESSAGE },
		{ actor: student },
	);
}

//
// create: who may ask and which blockers apply
//

test("create by a classmate who cannot read the answer is NotFound", async () => {
	const scenario = await makeScenario();
	const classmate = await enroll(scenario.course);

	await expect(
		db.regradeRequest.create(
			{
				course: scenario.course.id,
				submission: scenario.submission.publicId,
				message: MESSAGE,
			},
			{ actor: classmate },
		),
	).rejects.toBeInstanceOf(NotFound);
});

test("create by the course's instructor is NotAllowed", async () => {
	const { course, instructor, submission } = await makeScenario();

	await expect(
		db.regradeRequest.create(
			{ course: course.id, submission: submission.publicId, message: MESSAGE },
			{ actor: instructor },
		),
	).rejects.toBeInstanceOf(NotAllowed);
});

test("create is refused as invalid on submission while the grades are not released", async () => {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course);
	const open = await makeOpenExam(course);
	const { submission } = await answer(course, open, student, {
		score: "0",
		grader: instructor.username,
	});
	await prisma.exam.update({
		where: { id: open.exam.id },
		data: { status: "COMPLETED" },
	});

	const attempt = db.regradeRequest.create(
		{ course: course.id, submission: submission.publicId, message: MESSAGE },
		{ actor: student },
	);

	await expect(attempt).rejects.toBeInstanceOf(InvalidData);
	await expect(attempt).rejects.toMatchObject({
		errors: { submission: [expect.objectContaining({ code: "invalid" })] },
	});
});

test("create is refused when an older submission is contested while a newer one counts", async () => {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course);
	const open = await makeOpenExam(course);
	const { response, submission: older } = await answer(course, open, student, {
		score: "0",
		grader: instructor.username,
	});
	await persistedSubmissionFactory.create({
		response: { publicId: response.publicId },
		question: open.question.slug,
	});
	await release(open);

	const attempt = db.regradeRequest.create(
		{ course: course.id, submission: older.publicId, message: MESSAGE },
		{ actor: student },
	);

	await expect(attempt).rejects.toBeInstanceOf(InvalidData);
	await expect(attempt).rejects.toMatchObject({
		errors: { submission: [expect.objectContaining({ code: "invalid" })] },
	});
});

test("create is refused once 14 days passed since the release, and allowed just inside", async () => {
	const expired = await makeScenario();
	await prisma.exam.update({
		where: { id: expired.open.exam.id },
		data: { gradesReleasedAt: new Date(Date.now() - 15 * DAY) },
	});
	await expect(openRequest(expired)).rejects.toMatchObject({
		errors: { submission: [expect.objectContaining({ code: "invalid" })] },
	});

	const inside = await makeScenario();
	await prisma.exam.update({
		where: { id: inside.open.exam.id },
		data: { gradesReleasedAt: new Date(Date.now() - 13 * DAY) },
	});
	await expect(openRequest(inside)).resolves.toMatchObject({ status: "OPEN" });
});

//
// delete: withdrawing
//

test("withdrawing an OPEN request frees the answer for a new one", async () => {
	const scenario = await makeScenario();
	const first = await openRequest(scenario);
	const opts = { actor: scenario.student };

	await db.regradeRequest.delete(
		{ publicId: first.publicId, course: scenario.course.id },
		opts,
	);
	expect(
		await db.regradeRequest.findMany({ course: scenario.course.id }, opts),
	).toHaveLength(0);

	const second = await openRequest(scenario);

	expect(second.publicId).not.toBe(first.publicId);
	expect(second.status).toBe("OPEN");
});

test("withdrawing a resolved request is InvalidData on status", async () => {
	const scenario = await makeScenario();
	const request = await openRequest(scenario);
	await db.regradeRequest.reject(
		{ publicId: request.publicId },
		{ reply: "The grade stands." },
		{ actor: scenario.instructor },
	);

	const attempt = db.regradeRequest.delete(
		{ publicId: request.publicId, course: scenario.course.id },
		{ actor: scenario.student },
	);

	await expect(attempt).rejects.toBeInstanceOf(InvalidData);
	await expect(attempt).rejects.toMatchObject({
		errors: { status: expect.anything() },
	});
});

test("only the author withdraws: a classmate gets NotFound and the instructor NotAllowed", async () => {
	const scenario = await makeScenario();
	const request = await openRequest(scenario);
	const classmate = await enroll(scenario.course);
	const pk = { publicId: request.publicId, course: scenario.course.id };

	await expect(
		db.regradeRequest.delete(pk, { actor: classmate }),
	).rejects.toBeInstanceOf(NotFound);
	await expect(
		db.regradeRequest.delete(pk, { actor: scenario.instructor }),
	).rejects.toBeInstanceOf(NotAllowed);

	expect(await db.regradeRequest.findOne(pk, FULL_ACCESS)).not.toBeNull();
});

//
// findOne / findMany
//

test("findOne: the author and the instructor read a request, anyone else gets null", async () => {
	const scenario = await makeScenario();
	const request = await openRequest(scenario);
	const pk = { publicId: request.publicId, course: scenario.course.id };
	const classmate = await enroll(scenario.course);
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const otherCourse = await makeCourse();

	expect(
		(await db.regradeRequest.findOne(pk, { actor: scenario.student }))
			?.publicId,
	).toBe(request.publicId);
	expect(
		(await db.regradeRequest.findOne(pk, { actor: scenario.instructor }))
			?.publicId,
	).toBe(request.publicId);
	expect(await db.regradeRequest.findOne(pk, { actor: classmate })).toBeNull();
	expect(await db.regradeRequest.findOne(pk, { actor: admin })).toBeNull();
	expect(
		await db.regradeRequest.findOne(
			{ publicId: request.publicId, course: otherCourse.course.id },
			FULL_ACCESS,
		),
	).toBeNull();
});

test("findMany: a student sees only their own requests and cannot ask for another author's", async () => {
	const { course, instructor } = await makeCourse();
	const open = await makeOpenExam(course);
	const ana = await enroll(course);
	const bia = await enroll(course);
	const anaAnswer = await answer(course, open, ana, {
		score: "0",
		grader: instructor.username,
	});
	const biaAnswer = await answer(course, open, bia, {
		score: "0",
		grader: instructor.username,
	});
	await release(open);
	const forAna = await db.regradeRequest.create(
		{
			course: course.id,
			submission: anaAnswer.submission.publicId,
			message: MESSAGE,
		},
		{ actor: ana },
	);
	await db.regradeRequest.create(
		{
			course: course.id,
			submission: biaAnswer.submission.publicId,
			message: MESSAGE,
		},
		{ actor: bia },
	);

	const seenByAna = await db.regradeRequest.findMany(
		{ course: course.id },
		{ actor: ana },
	);
	expect(seenByAna.map((request) => request.publicId)).toEqual([
		forAna.publicId,
	]);

	await expect(
		db.regradeRequest.findMany(
			{ course: course.id, author: bia.username },
			{ actor: ana },
		),
	).rejects.toBeInstanceOf(NotAllowed);

	const seenByInstructor = await db.regradeRequest.findMany(
		{ course: course.id },
		{ actor: instructor },
	);
	expect(seenByInstructor).toHaveLength(2);
});

test("findMany orders OPEN requests oldest first, then resolved ones by newest resolvedAt", async () => {
	const { course, instructor } = await makeCourse();
	const open = await makeOpenExam(course);
	const requests = [];
	for (let i = 0; i < 4; i++) {
		const student = await enroll(course);
		const { submission } = await answer(course, open, student, {
			score: "0",
			grader: instructor.username,
		});
		requests.push({ student, submission });
	}
	await release(open);
	const created = [];
	for (const { student, submission } of requests) {
		created.push(
			await db.regradeRequest.create(
				{
					course: course.id,
					submission: submission.publicId,
					message: MESSAGE,
				},
				{ actor: student },
			),
		);
	}
	type Created = (typeof created)[number];
	const [r1, r2, r3, r4] = created as [Created, Created, Created, Created];
	// Resolved in the order r2, r1: r1 is the most recently resolved.
	for (const request of [r2, r1]) {
		await db.regradeRequest.reject(
			{ publicId: request.publicId },
			{ reply: "The grade stands." },
			{ actor: instructor },
		);
	}

	const listed = await db.regradeRequest.findMany(
		{ course: course.id },
		{ actor: instructor },
	);

	expect(listed.map((request) => request.publicId)).toEqual(
		[r3, r4, r1, r2].map((request) => request.publicId),
	);
});

test("findMany narrows by exam, status and author", async () => {
	const { course, instructor } = await makeCourse();
	const student = await enroll(course);
	const other = await enroll(course);
	const first = await makeOpenExam(course);
	const second = await makeOpenExam(course);
	const grade = { score: "0", grader: instructor.username };
	const firstAnswer = await answer(course, first, student, grade);
	const secondAnswer = await answer(course, second, student, grade);
	const otherAnswer = await answer(course, first, other, grade);
	await release(first);
	await release(second);
	const ask = (submission: { publicId: string }, actor: User) =>
		db.regradeRequest.create(
			{ course: course.id, submission: submission.publicId, message: MESSAGE },
			{ actor },
		);
	const onFirst = await ask(firstAnswer.submission, student);
	const onSecond = await ask(secondAnswer.submission, student);
	const byOther = await ask(otherAnswer.submission, other);
	await db.regradeRequest.reject(
		{ publicId: onSecond.publicId },
		{ reply: "The grade stands." },
		{ actor: instructor },
	);

	const publicIds = async (filter: {
		exam?: string;
		status?: "OPEN" | "REJECTED";
		author?: string;
	}) =>
		(
			await db.regradeRequest.findMany(
				{ course: course.id, ...filter },
				{ actor: instructor },
			)
		)
			.map((request) => request.publicId)
			.sort();

	expect(await publicIds({ exam: second.exam.slug })).toEqual([
		onSecond.publicId,
	]);
	expect(await publicIds({ status: "REJECTED" })).toEqual([onSecond.publicId]);
	expect(await publicIds({ status: "OPEN" })).toEqual(
		[onFirst.publicId, byOther.publicId].sort(),
	);
	expect(await publicIds({ author: other.username })).toEqual([
		byOther.publicId,
	]);
	expect(
		await publicIds({ exam: first.exam.slug, author: student.username }),
	).toEqual([onFirst.publicId]);
});

//
// accept / reject
//

/// The student's outcome for the scenario's question, from the passes they may read.
async function outcomeOf(scenario: Scenario): Promise<QuestionOutcome> {
	const { course, student, submission, open } = scenario;
	const passes = await db.feedback.findMany(
		{ course: course.id, submission: { publicId: submission.publicId } },
		{ actor: student },
	);
	const result = examResult(
		[open.question.slug],
		[
			{
				publicId: submission.publicId,
				question: open.question.slug,
				createdAt: submission.createdAt,
			},
		],
		passes.map((pass) => ({
			submission: pass.submission,
			score: pass.score,
			feedback: pass.feedback,
			updatedAt: pass.updatedAt,
		})),
	);
	const [outcome] = result.questions;
	if (!outcome) throw new Error("examResult returned no outcome");
	return outcome;
}

function passesOf({ course, instructor, submission }: Scenario) {
	return db.feedback.findMany(
		{ course: course.id, submission: { publicId: submission.publicId } },
		{ actor: instructor },
	);
}

test("accept writes the regrade pass, marks the request ACCEPTED and moves the student's grade", async () => {
	const scenario = await makeScenario("0");
	const request = await openRequest(scenario);
	expect((await outcomeOf(scenario)).score).toBe(0);

	const accepted = await db.regradeRequest.accept(
		{ publicId: request.publicId },
		{ score: "3/4", reply: "  Revised after review.  " },
		{ actor: scenario.instructor },
	);

	expect(accepted).toMatchObject({
		status: "ACCEPTED",
		reply: "Revised after review.",
		resolvedBy: scenario.instructor.username,
	});
	expect(accepted.resolvedAt).toBeInstanceOf(Date);
	expect(accepted.feedbackId).not.toBeNull();
	const pass = (await passesOf(scenario)).find(
		(candidate) => candidate.ref === `regrade-${request.publicId}`,
	);
	expect(pass).toMatchObject({
		id: accepted.feedbackId,
		score: "3/4",
		grader: scenario.instructor.username,
		feedback: "Revised after review.",
	});
	const outcome = await outcomeOf(scenario);
	expect(outcome.score).toBe(0.75);
	expect(outcome.comments).toContain("Revised after review.");
});

test("accept with the same score is allowed and still writes a pass", async () => {
	const scenario = await makeScenario("1/2");
	const request = await openRequest(scenario);

	const accepted = await db.regradeRequest.accept(
		{ publicId: request.publicId },
		{ score: "1/2", reply: "Reviewed, the grade stands." },
		{ actor: scenario.instructor },
	);

	expect(accepted.status).toBe("ACCEPTED");
	expect(await passesOf(scenario)).toHaveLength(2);
	expect((await outcomeOf(scenario)).score).toBe(0.5);
});

test("reject records the reply, leaves the grade alone and writes no pass", async () => {
	const scenario = await makeScenario("1/2");
	const request = await openRequest(scenario);

	const rejected = await db.regradeRequest.reject(
		{ publicId: request.publicId },
		{ reply: " The grade stands. " },
		{ actor: scenario.instructor },
	);

	expect(rejected).toMatchObject({
		status: "REJECTED",
		reply: "The grade stands.",
		feedbackId: null,
		resolvedBy: scenario.instructor.username,
	});
	expect(rejected.resolvedAt).toBeInstanceOf(Date);
	expect(await passesOf(scenario)).toHaveLength(1);
	expect((await outcomeOf(scenario)).score).toBe(0.5);
});

test("an invalid reply or score is InvalidData and leaves the request OPEN with no new pass", async () => {
	const scenario = await makeScenario();
	const request = await openRequest(scenario);
	const pk = { publicId: request.publicId };
	const opts = { actor: scenario.instructor };

	const blankReject = db.regradeRequest.reject(pk, { reply: "   " }, opts);
	await expect(blankReject).rejects.toBeInstanceOf(InvalidData);
	await expect(blankReject).rejects.toMatchObject({
		errors: { reply: expect.anything() },
	});
	const blankAccept = db.regradeRequest.accept(
		pk,
		{ score: "1", reply: "" },
		opts,
	);
	await expect(blankAccept).rejects.toMatchObject({
		errors: { reply: expect.anything() },
	});
	const badScore = db.regradeRequest.accept(
		pk,
		{ score: "2", reply: "Ok" },
		opts,
	);
	await expect(badScore).rejects.toMatchObject({
		errors: { score: expect.anything() },
	});

	expect((await db.regradeRequest.findOne(pk, opts))?.status).toBe("OPEN");
	expect(await passesOf(scenario)).toHaveLength(1);
});

test("a resolved request cannot be resolved again: InvalidData on status, nothing changes", async () => {
	const scenario = await makeScenario();
	const rejectedRequest = await openRequest(scenario);
	const opts = { actor: scenario.instructor };
	await db.regradeRequest.reject(
		{ publicId: rejectedRequest.publicId },
		{ reply: "The grade stands." },
		opts,
	);

	const acceptAfterReject = db.regradeRequest.accept(
		{ publicId: rejectedRequest.publicId },
		{ score: "1", reply: "Changed my mind." },
		opts,
	);
	await expect(acceptAfterReject).rejects.toBeInstanceOf(InvalidData);
	await expect(acceptAfterReject).rejects.toMatchObject({
		errors: { status: expect.anything() },
	});
	expect(await passesOf(scenario)).toHaveLength(1);

	const other = await makeScenario();
	const acceptedRequest = await openRequest(other);
	await db.regradeRequest.accept(
		{ publicId: acceptedRequest.publicId },
		{ score: "1", reply: "Revised." },
		{ actor: other.instructor },
	);
	const secondAccept = db.regradeRequest.accept(
		{ publicId: acceptedRequest.publicId },
		{ score: "0", reply: "Revised again." },
		{ actor: other.instructor },
	);
	await expect(secondAccept).rejects.toBeInstanceOf(InvalidData);
	await expect(secondAccept).rejects.toMatchObject({
		errors: { status: expect.anything() },
	});
	expect(await passesOf(other)).toHaveLength(2);
	expect((await outcomeOf(other)).score).toBe(1);
});

test("only the course's instructor resolves: the author is NotAllowed and an admin who does not teach it gets NotFound", async () => {
	const scenario = await makeScenario();
	const request = await openRequest(scenario);
	const pk = { publicId: request.publicId };
	const admin = await persistedUserFactory.create({ role: "ADMIN" });
	const reply = { reply: "Done." };

	await expect(
		db.regradeRequest.reject(pk, reply, { actor: scenario.student }),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.regradeRequest.accept(
			pk,
			{ ...reply, score: "1" },
			{ actor: scenario.student },
		),
	).rejects.toBeInstanceOf(NotAllowed);
	await expect(
		db.regradeRequest.reject(pk, reply, { actor: admin }),
	).rejects.toBeInstanceOf(NotFound);
	await expect(
		db.regradeRequest.accept(pk, { ...reply, score: "1" }, { actor: admin }),
	).rejects.toBeInstanceOf(NotFound);

	expect((await db.regradeRequest.findOne(pk, FULL_ACCESS))?.status).toBe(
		"OPEN",
	);
	expect(await passesOf(scenario)).toHaveLength(1);
});

test("accept is atomic: when the pass cannot be written the request stays OPEN", async () => {
	const scenario = await makeScenario();
	const request = await openRequest(scenario);
	// The ref the regrade pass needs is already taken on this answer.
	await db.feedback.create(
		{
			submission: { id: scenario.submission.id },
			ref: `regrade-${request.publicId}`,
			score: "0",
			grader: scenario.instructor.username,
		},
		FULL_ACCESS,
	);
	const before = (await passesOf(scenario)).length;

	await expect(
		db.regradeRequest.accept(
			{ publicId: request.publicId },
			{ score: "1", reply: "Revised." },
			{ actor: scenario.instructor },
		),
	).rejects.toThrow();

	const after = await db.regradeRequest.findOne(
		{ publicId: request.publicId },
		{ actor: scenario.instructor },
	);
	expect(after).toMatchObject({
		status: "OPEN",
		reply: null,
		feedbackId: null,
	});
	expect(await passesOf(scenario)).toHaveLength(before);
});
