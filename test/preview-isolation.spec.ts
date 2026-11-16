/**
 * The instructor's simulation of an exam changes no output that reads the
 * attempts of the students: grading tables, statistics, queues, counts, lists
 * and the release of grades measure the same with and without it. A reader
 * that is meant to see the simulation (its author, the worker) has its own
 * test at the end.
 *
 * Each test builds a course with students who answered, were graded and left
 * pending work, captures one reader, adds a delivered simulation (a pending
 * essay, a code send reported by the worker, an auto-graded choice, an edit
 * history) and captures the reader again.
 */
import { expect, test } from "@playwright/test";
import { FULL_ACCESS, SYSTEM } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { capitalChoice, idempotenceEssay } from "@/mdq/fixtures";
import { loadExamStaffData } from "@/utils/load-exam-staff";
import { loadExamGrading, loadGrades } from "@/utils/load-grading";
import { loadInstructorHome } from "@/utils/load-instructor-home";
import { loadStudentHome } from "@/utils/load-student-home";
import { appendBatch, MINUTE, tag } from "./answer-edit-service-support";
import {
	all,
	CORRECT,
	codeWorld,
	elmReport,
	PARTIAL,
	QUESTION,
	WORKER,
} from "./code-grading-support";

const ESSAY_TEXT = "Doing it twice changes nothing.";

interface WorldOptions {
	/// Grades every student's essay. Otherwise one stays pending.
	gradeEssays?: boolean;
	/// Leaves one student's code send in the worker's queue, unclaimed.
	queueOneSend?: boolean;
}

/**
 * A course with three students who finished an exam of a choice, an essay and
 * a code question, and whose exam is completed but not released.
 *
 * The first student's essay is graded with a rubric item and the second's
 * has an open regrade request. The third's is pending unless `gradeEssays`.
 */
async function makeWorld(options: WorldOptions = {}) {
	const base = await codeWorld();
	const { instructor, course, exam } = base;
	for (const [slug, question] of [
		["choice", capitalChoice],
		["essay", idempotenceEssay],
	] as const) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question,
			},
			FULL_ACCESS,
		);
	}
	await db.exam.update(
		{ course: course.id, slug: exam.slug },
		{
			questions: [{ slug: "choice" }, { slug: "essay" }, { slug: QUESTION }],
		},
		FULL_ACCESS,
	);
	const ref = { course: course.id, exam: exam.slug };
	const staff = { actor: instructor };

	const ada = await base.student(tag("ada"));
	const bob = await base.student(tag("bob"));
	const cid = await base.student(tag("cid"));
	const students = [ada, bob, cid];
	const attempts = new Map<string, string>();

	const answer = async (
		student: (typeof students)[number],
		question: string,
		payload: string,
	) => {
		const response = await db.response.submit(
			{ ...ref, question, payload: payload as never },
			{ actor: student },
		);
		attempts.set(student.username, response.publicId);
		return response;
	};
	const sitting: [(typeof students)[number], string, string][] = [
		[ada, "brasilia", "Idempotent calls leave the state as it was."],
		[bob, "rio", "It is when it can be repeated."],
		[cid, "sao-paulo", "Not sure."],
	];
	for (const [student, choice, essay] of sitting) {
		await answer(student, "choice", choice);
		const response = await answer(student, "essay", essay);
		await db.answerEdit.append(
			{
				...ref,
				attempt: response.publicId,
				fields: [
					{
						question: "essay",
						field: "answer",
						batch: appendBatch("", essay),
					},
				],
			},
			{ actor: student },
		);
	}
	// The worker corrects in the order the jobs were queued, so the student whose send stays queued goes last.
	await base.sendAndGrade(ada, CORRECT, all("pass"));
	await base.sendAndGrade(cid, CORRECT, all("fail"));
	if (options.queueOneSend) await base.send(bob, PARTIAL);
	else
		await base.sendAndGrade(bob, PARTIAL, {
			...all("pass"),
			negatives: "fail",
		});

	for (const student of students) {
		await db.response.finish(ref, { actor: student });
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});

	await db.rubric.createItem(
		{ ...ref, question: "essay" },
		{ key: "k1", text: "Explains idempotence", value: "1/2" },
		staff,
	);
	const essayOf = (username: string) =>
		prisma.submission.findFirstOrThrow({
			where: {
				response: { authorId: username, examId: exam.id },
				question: { slug: "essay" },
			},
			orderBy: { id: "desc" },
		});
	await db.feedback.create(
		{
			submission: { id: (await essayOf(ada.username)).id },
			ref: "rubric",
			rubric: ["k1"],
		} as never,
		staff,
	);
	await db.feedback.create(
		{
			submission: { id: (await essayOf(bob.username)).id },
			ref: "manual",
			score: "1/4",
		},
		staff,
	);
	if (options.gradeEssays) {
		await db.feedback.create(
			{
				submission: { id: (await essayOf(cid.username)).id },
				ref: "manual",
				score: "0",
			},
			staff,
		);
	}
	await prisma.regradeRequest.create({
		data: {
			publicId: tag("regrade-"),
			submissionId: (await essayOf(bob.username)).id,
			message: "I think the answer deserves more.",
		},
	});

	return { base, instructor, course, exam, ref, staff, students, attempts };
}

type World = Awaited<ReturnType<typeof makeWorld>>;

interface SimulationOptions {
	/// Has the worker claim and report the code send. Needs the queue to hold no other job.
	report?: boolean;
	/// Delivers the simulation. Otherwise it stays open.
	finish?: boolean;
	/// Grades the simulation's essay with the rubric item, as a leftover pass. Otherwise the essay stays pending.
	gradeEssay?: boolean;
}

/**
 * The instructor's simulation: a choice, a pending essay with an edit history
 * and a code send, delivered by default, with a regrade request left on the
 * choice answer.
 */
async function addSimulation(
	world: World,
	{ report = true, finish = true, gradeEssay = false }: SimulationOptions = {},
) {
	const { base, ref, staff, exam, instructor } = world;
	const submit = (question: string, payload: string, kind?: "SUBMIT") =>
		db.response.submit(
			{
				...ref,
				question,
				payload: payload as never,
				...(kind ? { kind } : {}),
			},
			staff,
		);

	await submit("choice", "brasilia");
	const attempt = await submit("essay", ESSAY_TEXT);
	await db.answerEdit.append(
		{
			...ref,
			attempt: attempt.publicId,
			fields: [
				{
					question: "essay",
					field: "answer",
					batch: appendBatch("", ESSAY_TEXT),
				},
			],
		},
		staff,
	);
	const sent = await submit(QUESTION, CORRECT, "SUBMIT");
	const submission = sent.submissions.at(-1)?.publicId ?? "";
	if (report) {
		await base.claim(submission);
		await db.gradingJob.complete(submission, elmReport(all("pass")), base.bot);
	}
	if (finish) await db.response.finish(ref, staff);

	const stored = (question: string) =>
		prisma.submission.findFirstOrThrow({
			where: {
				response: { examId: exam.id, preview: true },
				question: { slug: question },
			},
			orderBy: { id: "desc" },
		});
	if (gradeEssay) {
		const rubric = await prisma.rubric.findFirstOrThrow({
			where: { examId: exam.id, questionRef: { slug: "essay" } },
			include: { items: true },
		});
		await prisma.feedback.create({
			data: {
				ref: "leftover",
				submissionId: (await stored("essay")).id,
				score: "1/2",
				graderId: instructor.username,
				rubricId: rubric.id,
				rubricItems: {
					create: rubric.items.map((item) => ({ itemId: item.id })),
				},
			},
		});
	}
	await prisma.regradeRequest.create({
		data: {
			publicId: tag("regrade-"),
			submissionId: (await stored("choice")).id,
			message: "Left on a simulation.",
		},
	});
	return attempt;
}

/// Reads `read`, adds the simulation, and reads again.
async function acrossSimulation<T>(
	world: World,
	read: () => Promise<T>,
	options?: SimulationOptions,
): Promise<{ before: T; after: T }> {
	const before = await read();
	await addSimulation(world, options);
	return { before, after: await read() };
}

/// The exam as the instructor reads it now.
async function examOf(world: World) {
	const exam = await db.exam.findOne(
		{ course: world.course.id, slug: world.exam.slug },
		world.staff,
	);
	if (!exam) throw new Error("the exam is gone");
	return exam;
}

test("the instructor's exam data (results, statistics, pendencies, release blocker) ignores the simulation", async () => {
	const world = await makeWorld();
	const now = new Date();

	const { before, after } = await acrossSimulation(world, async () =>
		loadExamStaffData(
			world.course.id,
			await examOf(world),
			world.instructor,
			new Map(),
			now,
		),
	);

	expect(before.pending).toBeGreaterThan(0);
	expect(before.openRegrades).toBe(1);
	expect(after).toEqual(before);
});

test("an all-graded exam stays unblocked and unpending next to a simulation with pending work", async () => {
	const world = await makeWorld({ gradeEssays: true });
	const now = new Date();
	const read = async () =>
		loadExamStaffData(
			world.course.id,
			await examOf(world),
			world.instructor,
			new Map(),
			now,
		);

	const alone = await read();
	await addSimulation(world, { report: false });
	const data = await read();

	expect(alone.pending).toBe(0);
	expect(alone.releaseBlocker).toBeNull();
	expect(data.pending).toBe(0);
	expect(data.releaseBlocker).toBeNull();
	expect(data.resultRows).toHaveLength(3);
});

test("the course grades table and its CSV ignore the simulation", async () => {
	const world = await makeWorld();
	const now = new Date();

	const { before, after } = await acrossSimulation(world, () =>
		loadGrades(world.course.id, world.instructor, now),
	);

	expect(before.csvRows.length).toBeGreaterThan(1);
	expect(after).toEqual(before);
});

test("the grading queue (attempts, feedback, counting answers) ignores the simulation", async () => {
	const world = await makeWorld();

	const { before, after } = await acrossSimulation(world, () =>
		loadExamGrading(world.course.id, world.exam.slug, world.instructor),
	);

	expect(before?.attempts).toHaveLength(3);
	expect(after).toEqual(before);
});

test("the instructor's home ignores the simulation", async () => {
	const world = await makeWorld();
	const now = new Date();

	const { before, after } = await acrossSimulation(world, async () => ({
		all: await loadInstructorHome(world.instructor, now),
		only: await loadInstructorHome(
			world.instructor,
			now,
			await db.course
				.findOne({ id: world.course.id }, world.staff)
				.then((course) => course ?? undefined),
		),
	}));

	expect(after).toEqual(before);
});

test("each student's home ignores the simulation", async () => {
	const world = await makeWorld();
	const now = new Date();

	const { before, after } = await acrossSimulation(world, async () =>
		Promise.all(world.students.map((student) => loadStudentHome(student, now))),
	);

	expect(after).toEqual(before);
});

test("the exam list, for the instructor and for a student, ignores the simulation", async () => {
	const world = await makeWorld();
	const [ada] = world.students;
	if (!ada) throw new Error("no student");
	const course = world.course.id;

	const { before, after } = await acrossSimulation(world, async () => ({
		forInstructor: await db.exam.findMany({ course }, world.staff),
		attempts: await db.response.findMany(
			{ course, author: ada.username, practice: false },
			{ actor: ada },
		),
		feedback: await db.feedback.findMany(
			{ course, author: ada.username },
			{ actor: ada },
		),
	}));

	expect(after).toEqual(before);
});

test("releasing the grades goes through while the simulation has work pending", async () => {
	const world = await makeWorld({ gradeEssays: true });
	const alone = await loadExamStaffData(
		world.course.id,
		await examOf(world),
		world.instructor,
		new Map(),
		new Date(),
	);
	expect(alone.releaseBlocker).toBeNull();
	await addSimulation(world, { report: false });

	const released = await db.exam.releaseGrades(
		{ course: world.course.id, slug: world.exam.slug },
		world.staff,
	);

	expect(released.gradesReleasedAt).not.toBeNull();
});

test("the regrade request lists ignore the simulation", async () => {
	const world = await makeWorld();
	const course = world.course.id;
	const lists = async () => ({
		open: await db.regradeRequest.findMany(
			{ course, status: "OPEN" },
			world.staff,
		),
		ofExam: await db.regradeRequest.findMany(
			{ course, exam: world.exam.slug },
			world.staff,
		),
		ofInstructor: await db.regradeRequest.findMany(
			{ course, author: world.instructor.username },
			world.staff,
		),
	});

	const { before, after } = await acrossSimulation(world, lists);

	expect(before.open).toHaveLength(1);
	expect(after).toEqual(before);
});

test("the edit history statistics ignore the simulation", async () => {
	const world = await makeWorld();

	const { before, after } = await acrossSimulation(world, () =>
		db.answerEdit.stats({ course: world.course.id }, { actor: SYSTEM }),
	);

	expect(before.total.withHistory).toBe(3);
	expect(after).toEqual(before);
});

test("the rubric item uses ignore the simulation's pass", async () => {
	const world = await makeWorld();
	const pk = { ...world.ref, question: "essay" };

	const { before, after } = await acrossSimulation(
		world,
		() => db.rubric.findOne(pk, world.staff),
		{ gradeEssay: true },
	);

	expect(before.items.find((item) => item.key === "k1")?.uses).toBe(1);
	expect(after).toEqual(before);
});

test("the worker's instructor view of the sends ignores the simulation", async () => {
	const world = await makeWorld();
	const responses = [...world.attempts.values()];
	const read = () =>
		db.gradingJob.forInstructor({ responses, question: QUESTION }, world.staff);

	const { before, after } = await acrossSimulation(world, read);

	expect(Object.keys(before)).toHaveLength(3);
	expect(after).toEqual(before);
});

test("settleExpired and gradeObjectives grade nothing of a simulation whose time ran out", async () => {
	const world = await makeWorld();
	await prisma.exam.update({
		where: { id: world.exam.id },
		data: { durationMs: 60 * MINUTE },
	});
	const settle = () => db.response.settleExpired(world.ref, world.staff);
	const dryRun = () =>
		db.response.gradeObjectives(
			{ course: world.course.id, dryRun: true, released: true },
			{ actor: SYSTEM },
		);
	const settled = await settle();
	const planned = await dryRun();

	await addSimulation(world, { report: false, finish: false });
	await prisma.response.updateMany({
		where: { examId: world.exam.id, preview: true },
		data: { createdAt: new Date(Date.now() - 180 * MINUTE) },
	});

	expect(await settle()).toBe(settled);
	expect(await dryRun()).toEqual(planned);
	await db.response.gradeObjectives(
		{ course: world.course.id, released: true },
		{ actor: SYSTEM },
	);
	expect(
		await prisma.feedback.count({
			where: { submission: { response: { preview: true } } },
		}),
	).toBe(0);
});

test("claiming sends the unsent autosave of a student whose time ran out, and never a simulation's", async () => {
	const world = await makeWorld();
	const late = await world.base.student(tag("late"));
	await prisma.exam.update({
		where: { id: world.exam.id },
		data: { status: "ONGOING" },
	});
	await db.response.submit(
		{ ...world.ref, question: QUESTION, payload: "student draft" },
		{ actor: late },
	);
	await db.response.submit(
		{ ...world.ref, question: QUESTION, payload: "simulation draft" },
		world.staff,
	);
	await prisma.exam.update({
		where: { id: world.exam.id },
		data: { durationMs: 60 * MINUTE, status: "COMPLETED" },
	});
	await prisma.response.updateMany({
		where: {
			examId: world.exam.id,
			OR: [{ preview: true }, { authorId: late.username }],
		},
		data: { createdAt: new Date(Date.now() - 180 * MINUTE) },
	});

	await db.gradingJob.claim({ workers: [WORKER], limit: 20 }, world.base.bot);

	const sentBy = (where: object) =>
		prisma.submission.count({
			where: { kind: "FINAL", response: { examId: world.exam.id, ...where } },
		});
	expect(await sentBy({ authorId: late.username })).toBe(1);
	expect(await sentBy({ preview: true })).toBe(0);
	expect(
		await prisma.gradingJob.count({
			where: { submission: { response: { preview: true } } },
		}),
	).toBe(0);
});

test("the response list leaves the simulation out by default", async () => {
	const world = await makeWorld();
	const course = world.course.id;
	const lists = async () => ({
		course: await db.response.findMany({ course }, world.staff),
		exam: await db.response.findMany(
			{ course, exam: world.exam.slug, practice: false },
			world.staff,
		),
	});

	const { before, after } = await acrossSimulation(world, lists);

	expect(after).toEqual(before);
	expect(
		await db.response.findMany(
			{ course, author: world.instructor.username },
			world.staff,
		),
	).toEqual([]);
});

test("the submission list leaves the simulation's answers out by default", async () => {
	const world = await makeWorld();
	const course = world.course.id;
	const lists = async () => ({
		course: await db.submission.findMany({ course }, world.staff),
		exam: await db.submission.findMany(
			{ course, exam: world.exam.slug },
			world.staff,
		),
		code: await db.submission.findMany(
			{ course, question: QUESTION },
			world.staff,
		),
	});

	const { before, after } = await acrossSimulation(world, lists);

	expect(after).toEqual(before);
	expect(
		await db.submission.findMany(
			{ course, author: world.instructor.username },
			world.staff,
		),
	).toEqual([]);
});

test("the feedback list leaves the simulation's passes out by default", async () => {
	const world = await makeWorld();
	const course = world.course.id;
	const lists = async () => ({
		course: await db.feedback.findMany({ course }, world.staff),
		exam: await db.feedback.findMany(
			{ course, exam: world.exam.slug },
			world.staff,
		),
		automated: await db.feedback.findMany(
			{ course, automated: true },
			world.staff,
		),
	});

	const { before, after } = await acrossSimulation(world, lists);

	expect(after).toEqual(before);
	expect(
		await db.feedback.findMany(
			{ course, author: world.instructor.username },
			world.staff,
		),
	).toEqual([]);
});

test("the response list returns the simulation, and only it, when asked for previews", async () => {
	const world = await makeWorld();
	const simulation = await addSimulation(world);

	// `preview` is not in the filter's type until the isolation filter exists.
	const found = await db.response.findMany(
		{ course: world.course.id, preview: true } as never,
		world.staff,
	);

	expect(found.map((response) => response.publicId)).toEqual([
		simulation.publicId,
	]);
});

test("the author reads the simulation by id, with its grading pass and its sends", async () => {
	const world = await makeWorld();
	const simulation = await addSimulation(world);

	const response = await db.response.findOne(
		{ publicId: simulation.publicId },
		world.staff,
	);
	const pass = await prisma.feedback.findFirstOrThrow({
		where: { submission: { response: { publicId: simulation.publicId } } },
	});
	const feedback = await db.feedback.findOne(
		{ id: pass.id } as never,
		world.staff,
	);
	const sends = await db.gradingJob.forStudent(
		{ response: simulation.publicId, question: QUESTION },
		world.staff,
	);

	expect(response?.preview).toBe(true);
	expect(response?.submissions.length).toBeGreaterThan(0);
	expect(feedback).not.toBeNull();
	expect(sends.attemptsLeft).toBeNull();
});

test("the worker claims the simulation's send like any other job", async () => {
	const world = await makeWorld({ queueOneSend: true });
	await addSimulation(world, { report: false });

	const jobs = await db.gradingJob.claim(
		{ workers: [WORKER], limit: 20 },
		world.base.bot,
	);

	const students = jobs.map((job) => job.student);
	expect(students).toContain(world.instructor.username);
	expect(students).toHaveLength(2);
});
