import { readFileSync } from "node:fs";
import { expect } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { capitalChoice, fibonacciOrdering } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { seedUser } from "./helpers";
import { requestRegrade } from "./regrade-setup";

/// The messages of the locale the test server is built for; the default test build is English.
const LOCALE = process.env.CODEHOOD_LOCALE === "pt-BR" ? "pt-BR" : "en";
const CATALOG: Record<string, string> = JSON.parse(
	readFileSync(`./messages/${LOCALE}/grades.json`, "utf8"),
);

/// What the page calls its buttons and flags: the `grades_objective_*` messages, so the tests do not depend on the wording.
export type ObjectiveLabel =
	| "change_grade"
	| "edit_question"
	| "give_grade"
	| "mark_correct"
	| "mark_wrong"
	| "pending"
	| "regrade"
	| "review"
	| "undo"
	| "varies"
	| "view_request";

/// The text of a message of `messages/<locale>/grades.json`; it throws when the catalog lacks the key.
export function gradesMessage(key: string): string {
	const text = CATALOG[key];
	if (text === undefined) throw new Error(`missing message ${key}`);
	return text;
}

/// The text of a `grades_objective_*` message.
export function objectiveLabel(label: ObjectiveLabel): string {
	return gradesMessage(`grades_objective_${label}`);
}

/// The comment the instructor writes when marking a grade as right.
export const CHALLENGE_COMMENT = "Solved the in-class challenge";

/// The comment of the grade that was changed before the story starts.
export const PARTIAL_COMMENT = "Half credit for the right idea";

/**
 * A closed exam with an automatic `q-choice` (key: Brasília) and an `q-order` ordering, answered by four students.
 *
 * - Ana, Bia and Davi picked "Rio de Janeiro"; Caio picked "Brasília". The key is wrong in spirit: the three who picked
 *   Rio get the rest of the exam right, Caio gets the ordering wrong.
 * - Ana's grade on `q-choice` was changed by hand to 50% before the story (an automatic pass, then the instructor's).
 * - Bia has an open regrade request on `q-choice`.
 * - Davi picked "Rio de Janeiro" like Ana and Bia and is graded like them.
 *
 * Every student has a distinct full name, so the page's names can be told from usernames.
 */
export async function objectiveExam(prefix: string) {
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
	for (const [slug, title, question] of [
		["q-choice", "Chosen capital", capitalChoice],
		["q-order", "Fibonacci loop", fibonacciOrdering],
	] as const) {
		await db.question.create(
			{
				course: course.id,
				slug,
				status: "PUBLISHED",
				version: "1",
				question: { ...question, id: slug, title },
			},
			FULL_ACCESS,
		);
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "obj-exam",
		title: "Objective exam",
		type: "EXAM",
		status: "ONGOING",
		duration: { hours: 1 },
		questions: [{ slug: "q-choice" }, { slug: "q-order" }],
	});

	const lines = fibonacciOrdering.lines;
	const [first, second, third, fourth] = lines;
	const swapped = [first, second, fourth, third];
	const roster = [
		["ana", "Ana Prado", "rio", lines],
		["bia", "Bia Lima", "rio", lines],
		["caio", "Caio Nunes", "brasilia", swapped],
		["davi", "Davi Rocha", "rio", lines],
	] as const;
	const people: Record<
		"ana" | "bia" | "caio" | "davi",
		Awaited<ReturnType<typeof seedUser>> & { submission: string }
	> = {} as never;
	for (const [key, name, pick, order] of roster) {
		const student = await seedUser({
			role: "STUDENT",
			username: `${prefix}-${key}`,
			name,
		});
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		const choice = await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-choice",
				payload: pick,
			},
			{ actor: student },
		);
		await db.response.submit(
			{
				course: course.id,
				exam: exam.slug,
				question: "q-order",
				payload: order,
			},
			{ actor: student },
		);
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
		people[key] = {
			...student,
			submission: choice.submissions.at(-1)?.publicId ?? "",
		};
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: {
			status: "COMPLETED",
			gradesReleasedAt: new Date(Date.now() - 60_000),
		},
	});

	// The server grades the objectives after the attempts close; the changes below go on top of those passes.
	await expect
		.poll(() =>
			prisma.feedback.count({
				where: { submission: { response: { examId: exam.id } } },
			}),
		)
		.toBe(roster.length * 2);
	// Ana's grade was changed by hand: the automatic pass stays under it.
	await db.feedback.create(
		{
			submission: { publicId: people.ana.submission },
			ref: "pass-manual",
			score: "0.5",
			grader: teacher.username,
			feedback: PARTIAL_COMMENT,
		},
		FULL_ACCESS,
	);
	// Bia contests hers.
	await requestRegrade(course, people.bia, people.bia.submission);

	return {
		teacher,
		course,
		href,
		exam,
		/// The page of the objective question.
		choiceUrl: `${href}/exams/${exam.slug}/grading/q-choice`,
		/// The page of the ordering question.
		orderUrl: `${href}/exams/${exam.slug}/grading/q-order`,
		regradesUrl: `${href}/exams/${exam.slug}/regrades`,
		...people,
	};
}

/// The grading passes of an answer, oldest first, as `{ ref, score, grader, comment }`.
export async function passesOf(submission: string) {
	const rows = await prisma.feedback.findMany({
		where: { submission: { publicId: submission } },
		orderBy: { id: "asc" },
		select: { ref: true, score: true, graderId: true, feedback: true },
	});
	return rows.map((row) => ({
		ref: row.ref,
		score: Number(row.score),
		grader: row.graderId,
		comment: row.feedback,
	}));
}
