import type { UserActor } from "@/auth/actor";
import { type Course, db } from "@/db";
import { questionProblems } from "@/mdq";
import { examResult } from "@/services/exam-result";
import {
	type ExamRegrades,
	type InstructorHome,
	instructorHome,
	type RegradeQueueItem,
	regradeQueue,
	type TaughtCourse,
	type TaughtExam,
} from "@/services/instructor-home";
import { courseHref } from "@/urls";
import { loadCourseExceptions } from "./load-exam-exceptions";

/**
 * Loads the courses `actor` teaches and builds their home page sections at `now`.
 *
 * Each course costs one query per kind of data, never one per exam or student.
 *
 * @param only Builds the sections for this course alone, which the caller
 *   has already checked `actor` may manage.
 */
export async function loadInstructorHome(
	actor: UserActor,
	now: Date,
	only?: Course,
): Promise<InstructorHome & { regrades: RegradeQueueItem[] }> {
	const courses = only
		? [only]
		: (await db.course.findMany({}, { actor })).filter(
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
			const [exams, attempts, feedback, questions, exceptions, open] =
				await Promise.all([
					db.exam.findMany({ course: course.id }, { actor }),
					db.response.findMany(
						{ course: course.id, practice: false },
						{ actor },
					),
					db.feedback.findMany({ course: course.id }, { actor }),
					db.question.findMany({ course: course.id, public: false }, { actor }),
					loadCourseExceptions(course.id),
					db.regradeRequest.findMany(
						{ course: course.id, status: "OPEN" },
						{ actor },
					),
				]);

			const taughtExams: TaughtExam[] = exams.map((exam) => ({
				course: home,
				exam,
				enrolled: course.enrollmentCount,
				exceptions: exceptions.get(exam.slug),
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
					({ question }) => questionProblems(question).length > 0,
				).length,
			};
			const regrades: ExamRegrades[] = exams.map((exam) => ({
				course: home,
				exam,
				requests: open.filter((request) => request.exam === exam.slug),
			}));
			return { taughtExams, taughtCourse, regrades };
		}),
	);

	return {
		...instructorHome(
			loaded.flatMap(({ taughtExams }) => taughtExams),
			loaded.map(({ taughtCourse }) => taughtCourse),
			now,
		),
		regrades: regradeQueue(loaded.flatMap(({ regrades }) => regrades)),
	};
}
