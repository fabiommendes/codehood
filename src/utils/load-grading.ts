import type { AstroGlobal } from "astro";
import type { UserActor } from "@/auth/actor";
import {
	type Response as Attempt,
	type Course,
	db,
	type Exam,
	type Feedback,
} from "@/db";
import {
	type GradesTable,
	gradesCsvRows,
	gradesTable,
} from "@/services/grades-table";
import {
	type CountingAnswer,
	countingAnswers,
	type GradedStudent,
} from "@/services/grading";
import { loadCourse } from "./load-course";

export type LoadGradingResult =
	| {
			course: Course;
			/// The course's URL prefix.
			href: string;
			exam: Exam;
			/// The exam's question slugs, in exam order.
			questions: string[];
			/// The counting answers of every closed attempt, in submission order.
			answers: CountingAnswer[];
			/// Every non-practice attempt at the exam.
			attempts: Attempt[];
			/// Every grading pass on the exam, released or not.
			feedback: Feedback[];
	  }
	| { redirect: Response };

/**
 * Loads what every grading page of one exam needs, or the response that refuses the visitor.
 *
 * An anonymous visitor is redirected to `/login`. Anyone but the course's
 * instructor gets the 403 page, before the exam is looked up. The instructor
 * gets the 404 page for an exam that does not exist or is a practice exam.
 */
export async function loadGrading(
	Astro: AstroGlobal,
	discipline: string | undefined,
	courseSegment: string | undefined,
	examSlug: string | undefined,
): Promise<LoadGradingResult> {
	const result = await loadCourse(Astro, discipline, courseSegment, {
		manage: true,
	});
	if ("redirect" in result) return result;
	const { course, href } = result;

	// biome-ignore lint/style/noNonNullAssertion: loadCourse already redirected an anonymous visitor.
	const actor = Astro.locals.actor!;

	const exam = examSlug
		? await db.exam.findOne({ course: course.id, slug: examSlug }, { actor })
		: null;
	if (!exam || exam.type === "PRACTICE") {
		return { redirect: await Astro.rewrite("/404") };
	}

	const [attempts, feedback] = await Promise.all([
		db.response.findMany(
			{ course: course.id, exam: exam.slug, practice: false },
			{ actor },
		),
		db.feedback.findMany({ course: course.id, exam: exam.slug }, { actor }),
	]);
	const questions = exam.questions.map((question) => question.slug);

	return {
		course,
		href,
		exam,
		questions,
		answers: countingAnswers(exam, questions, attempts, feedback, new Date()),
		attempts,
		feedback,
	};
}

/**
 * The students of a course, dropped ones included.
 *
 * The enrollment service lists one status per query, so this makes one for
 * each.
 */
export async function loadStudents(
	course: Course["id"],
	actor: UserActor,
): Promise<GradedStudent[]> {
	const [active, dropped] = await Promise.all([
		db.enrollment.findMany({ course, status: "ACTIVE" }, { actor }),
		db.enrollment.findMany({ course, status: "DROPPED" }, { actor }),
	]);
	return [
		...active.map(({ username, name }) => ({ username, name, dropped: false })),
		...dropped.map(({ username, name }) => ({ username, name, dropped: true })),
	];
}

/// A course's grades as the page shows them and as the CSV file holds them.
export interface CourseGrades {
	/// The active students against every exam.
	table: GradesTable;
	/// The rows of the CSV file, which lists the dropped students too.
	csvRows: (string | number)[][];
}

/**
 * Builds the course's grades table and its CSV rows at `now`.
 *
 * One query per kind of data, never one per student or exam.
 */
export async function loadGrades(
	course: Course["id"],
	actor: UserActor,
	now: Date,
): Promise<CourseGrades> {
	const [exams, students, attempts, feedback] = await Promise.all([
		db.exam.findMany({ course }, { actor }),
		loadStudents(course, actor),
		db.response.findMany({ course, practice: false }, { actor }),
		db.feedback.findMany({ course }, { actor }),
	]);
	return {
		table: gradesTable(exams, students, attempts, feedback, now),
		csvRows: gradesCsvRows(
			gradesTable(exams, students, attempts, feedback, now, {
				withDropped: true,
			}),
		),
	};
}
