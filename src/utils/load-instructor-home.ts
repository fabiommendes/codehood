import type { UserActor } from "@/auth/actor";
import { db } from "@/db";
import { Question } from "@/mdq/question";
import { examResult } from "@/services/exam-result";
import {
	type InstructorHome,
	instructorHome,
	type TaughtCourse,
	type TaughtExam,
} from "@/services/instructor-home";
import { courseHref } from "@/urls";

/**
 * Loads the courses `actor` teaches and builds their home page sections at `now`.
 *
 * Each course costs one query per kind of data, never one per exam or student.
 */
export async function loadInstructorHome(
	actor: UserActor,
	now: Date,
): Promise<InstructorHome> {
	const courses = (await db.course.findMany({}, { actor })).filter(
		(course) => course.instructor.username === actor.username,
	);

	const loaded = await Promise.all(
		courses.map(async (course) => {
			const home = {
				href: courseHref({
					discipline: course.discipline.slug,
					instructor: course.instructor.username,
					edition: course.edition.slug,
				}),
				code: course.discipline.slug,
				name: course.discipline.name,
			};
			const [exams, attempts, feedback, questions] = await Promise.all([
				db.exam.findMany({ course: course.id }, { actor }),
				db.response.findMany({ course: course.id, practice: false }, { actor }),
				db.feedback.findMany({ course: course.id }, { actor }),
				db.question.findMany({ course: course.id, public: false }, { actor }),
			]);

			const taughtExams: TaughtExam[] = exams.map((exam) => ({
				course: home,
				exam,
				enrolled: course.enrollmentCount,
				attempts: attempts
					.filter((attempt) => attempt.exam === exam.slug)
					.map((attempt) => ({
						attempt,
						result: examResult(
							exam.questions.map((question) => question.slug),
							attempt.submissions,
							feedback,
						),
					})),
			}));
			const taughtCourse: TaughtCourse = {
				course: home,
				questionsWithProblems: questions.filter(
					({ question }) => new Question(question).validate().length > 0,
				).length,
			};
			return { taughtExams, taughtCourse };
		}),
	);

	return instructorHome(
		loaded.flatMap(({ taughtExams }) => taughtExams),
		loaded.map(({ taughtCourse }) => taughtCourse),
		now,
	);
}
