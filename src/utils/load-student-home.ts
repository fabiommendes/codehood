import type { UserActor } from "@/auth/actor";
import { db, resultsReleased } from "@/db";
import { examResult } from "@/services/exam-result";
import {
	type HomeCourse,
	type HomeEvent,
	type HomeExam,
	type StudentHome,
	studentHome,
} from "@/services/student-home";
import { courseHref } from "@/urls";
import { localDateOf, toInstant } from "./schedule-time";

/**
 * Loads what `actor` takes as a student and builds their home page sections at `now`.
 *
 * Courses the actor teaches are left out. Each course costs one query per
 * kind of data, never one per exam.
 */
export async function loadStudentHome(
	actor: UserActor,
	now: Date,
): Promise<StudentHome> {
	const courses = (await db.course.findMany({}, { actor })).filter(
		(course) => course.instructor.username !== actor.username,
	);

	const perCourse = await Promise.all(
		courses.map(async (course) => {
			const home: HomeCourse = {
				href: courseHref({
					discipline: course.discipline.slug,
					instructor: course.instructor.username,
					edition: course.edition.slug,
				}),
				code: course.discipline.slug,
				name: course.discipline.name,
			};
			const [exams, attempts, feedback] = await Promise.all([
				db.exam.findMany({ course: course.id }, { actor }),
				db.response.findMany(
					{ course: course.id, author: actor.username, practice: false },
					{ actor },
				),
				db.feedback.findMany(
					{ course: course.id, author: actor.username },
					{ actor },
				),
			]);

			const homeExams: HomeExam[] = exams.map((exam) => {
				const attempt = attempts.find((entry) => entry.exam === exam.slug);
				const released = attempt && resultsReleased(exam, now);
				return {
					course: home,
					exam,
					attempt: attempt ?? null,
					result: released
						? examResult(
								exam.questions.map((question) => question.slug),
								attempt.submissions,
								feedback,
							)
						: null,
				};
			});
			return { course, home, homeExams };
		}),
	);

	const homeByCourse = new Map(
		perCourse.map(({ course, home }) => [course.id, home]),
	);
	const events =
		courses.length > 0
			? await db.calendarEvent.findMany(
					{
						courseIds: courses.map((course) => course.id),
						from: toInstant(localDateOf(now), 0),
					},
					{ actor },
				)
			: [];
	const homeEvents: HomeEvent[] = events.flatMap((event) => {
		const course = homeByCourse.get(event.courseId);
		if (!course) return [];
		return [
			{ course, title: event.title, kind: event.kind, startAt: event.startAt },
		];
	});

	return studentHome(
		perCourse.flatMap(({ homeExams }) => homeExams),
		homeEvents,
		now,
	);
}
