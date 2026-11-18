import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice, capitalShortAnswerManual } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { seedUser } from "./helpers";

/// The slugs of the exam's four questions, in exam order.
export const QUESTIONS = ["q-one", "q-two", "q-three", "q-four"] as const;

/// What a student writes in a choice question to get it right, and to get it wrong.
const RIGHT = "brasilia";
const WRONG = "rio";

/// How a student answers: `true` is right, `false` is wrong, `null` leaves the question blank, one entry per question.
type Answers = readonly (boolean | null)[];

/// The registration of the student who has no attempt, for the roster search.
export const HANA_SCHOOL_ID = "20260077";

/**
 * A closed exam of four equal choice questions, answered by seven students with grades that are easy to adjust.
 *
 * - Ana Prado: 2 right, 50%. Bia Lima: 3 right, 75%. Caio Nunes: 2 right, 50%.
 * - Davi Rocha: 4 right, 100%. Eva Tavares: 3 right and the fourth blank, 75%. Fabio Reis: 4 right, 100%.
 * - Hana Souza is enrolled, has the registration {@link HANA_SCHOOL_ID} and never took the exam.
 *
 * `prefix` keeps usernames unique to one story. The exam is `COMPLETED` and its grades are not released.
 */
export async function adjustableExam(prefix: string) {
	const teacher = await seedUser({
		role: "INSTRUCTOR",
		username: `${prefix}-prof`,
	});
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	for (const slug of QUESTIONS) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question: { ...capitalChoice, id: slug, title: `Capital ${slug}` },
			},
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "adjust-exam",
		title: "Adjust exam",
		type: "EXAM",
		status: "ONGOING",
		duration: { hours: 1 },
		questions: QUESTIONS.map((slug) => ({ slug })),
	});

	/// Enrolls a new student and has them answer as `answers` say, closing the attempt when they answered at all.
	async function student(
		key: string,
		name: string,
		answers: Answers | null,
		schoolId?: string,
	) {
		const user = await seedUser({
			role: "STUDENT",
			username: `${prefix}-${key}`,
			name,
			...(schoolId ? { schoolId } : {}),
		});
		await db.enrollment.create(
			{ course: course.id, username: user.username },
			FULL_ACCESS,
		);
		if (!answers) return user;
		for (const [index, answer] of answers.entries()) {
			if (answer === null) continue;
			await db.response.submit(
				{
					course: course.id,
					exam: exam.slug,
					question: QUESTIONS[index] ?? "",
					payload: answer ? RIGHT : WRONG,
				},
				{ actor: user },
			);
		}
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: user },
		);
		return user;
	}

	const people = {
		ana: await student("ana", "Ana Prado", [true, true, false, false]),
		bia: await student("bia", "Bia Lima", [true, true, true, false]),
		caio: await student("caio", "Caio Nunes", [true, true, false, false]),
		davi: await student("davi", "Davi Rocha", [true, true, true, true]),
		eva: await student("eva", "Eva Tavares", [true, true, true, null]),
		fabio: await student("fabio", "Fabio Reis", [true, true, true, true]),
		hana: await student("hana", "Hana Souza", null, HANA_SCHOOL_ID),
	};
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});

	return {
		teacher,
		course,
		href,
		exam,
		examUrl: `${href}/exams/${exam.slug}`,
		...people,
	};
}

/// The world {@link adjustableExam} builds.
export type AdjustableExam = Awaited<ReturnType<typeof adjustableExam>>;

/**
 * Adjusts `usernames` on the whole exam through the service, as a bonus of ten points unless `extra` says otherwise.
 *
 * Arrangement only: a story that is about adjusting does it on the page.
 */
export function adjust(
	world: AdjustableExam,
	usernames: string[],
	extra: {
		op?: "SET" | "FACTOR" | "OFFSET";
		value?: string;
		reason?: string;
		/// The slug of the question the adjustment hits, instead of the whole exam.
		question?: string;
	} = {},
) {
	return db.examAdjustment.create(
		{
			course: world.course.id,
			exam: world.exam.slug,
			usernames,
			op: extra.op ?? "OFFSET",
			value: extra.value ?? "0.1",
			reason: extra.reason ?? "Arranged by the test",
			...(extra.question ? { question: extra.question } : {}),
		},
		{ actor: world.teacher },
	);
}

/**
 * Adds to the world's course a closed exam of choice questions `questions`, creating those that are not one of {@link QUESTIONS}.
 *
 * Nobody answers it: it serves to look at the page of a student who has no attempt. A `PRACTICE` exam is ongoing.
 */
export async function addExam(
	world: AdjustableExam,
	slug: string,
	questions: readonly string[],
	extra: { type?: "EXAM" | "PRACTICE" } = {},
) {
	for (const question of questions) {
		if ((QUESTIONS as readonly string[]).includes(question)) continue;
		await db.question.create(
			{
				course: world.course.id,
				slug: question,
				status: "PUBLISHED",
				version: "1",
				question: {
					...capitalChoice,
					id: question,
					title: `Capital ${question}`,
				},
			},
			FULL_ACCESS,
		);
	}
	const type = extra.type ?? "EXAM";
	return persistedExamFactory.create({
		course: world.course.id,
		slug,
		title: slug,
		type,
		status: type === "PRACTICE" ? "ONGOING" : "COMPLETED",
		duration: { hours: 1 },
		questions: questions.map((question) => ({ slug: question })),
	});
}

/**
 * Adds a closed exam of one choice question and one essay, and Pia, whose essay nobody graded, so her total is pending.
 *
 * Pia got the choice question right.
 */
export async function pendingExam(world: AdjustableExam, prefix: string) {
	await db.question.create(
		{
			course: world.course.id,
			slug: "q-essay",
			status: "PUBLISHED",
			version: "1",
			question: { ...capitalShortAnswerManual, id: "q-essay", title: "Essay" },
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: world.course.id,
		slug: "pending-exam",
		title: "Pending exam",
		type: "EXAM",
		status: "ONGOING",
		duration: { hours: 1 },
		questions: [{ slug: QUESTIONS[0] }, { slug: "q-essay" }],
	});
	const pia = await seedUser({
		role: "STUDENT",
		username: `${prefix}-pia`,
		name: "Pia Costa",
	});
	await db.enrollment.create(
		{ course: world.course.id, username: pia.username },
		FULL_ACCESS,
	);
	for (const [question, payload] of [
		[QUESTIONS[0], RIGHT],
		["q-essay", "Brasilia, I think"],
	] as const) {
		await db.response.submit(
			{ course: world.course.id, exam: exam.slug, question, payload },
			{ actor: pia },
		);
	}
	await db.response.finish(
		{ course: world.course.id, exam: exam.slug },
		{ actor: pia },
	);
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});
	return { exam, pia, url: `${world.href}/exams/${exam.slug}` };
}
