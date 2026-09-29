import type { AstroGlobal } from "astro";
import { type Course, db, type Exam } from "@/db";
import { type CountingAnswer, countingAnswers } from "@/services/grading";
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
	};
}
