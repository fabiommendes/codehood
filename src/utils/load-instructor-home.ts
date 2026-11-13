import type { UserActor } from "@/auth/actor";
import { type Course, db } from "@/db";
import { loadResultPolicy } from "@/db/result-policy";
import { questionProblems } from "@/mdq";
import { examResult } from "@/services/exam-result";
import {
	type ExamRegrades,
	type InstructorHome,
	instructorHome,
	type RegradeQueueItem,
	regradeQueue,
	type TaughtCourse,
	type TaughtEvent,
	type TaughtExam,
} from "@/services/instructor-home";
import type { HomeCourse } from "@/services/student-home";
import { courseHref } from "@/urls";
import { loadCourseExceptions } from "./load-exam-exceptions";
import { durationToMinutes, startOfLocalDay } from "./schedule-time";

/**
 * Loads the courses `actor` teaches and builds their home page sections at `now`.
 *
 * Each course costs one query per kind of data, never one per exam or student.
 * Meetings, roll calls and reports are left out when building for `only`.
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

	const codes = courses.map((course) => course.discipline.slug);
	const repeated = new Set(
		codes.filter((code, i) => codes.indexOf(code) !== i),
	);

	const loaded = await Promise.all(
		courses.map(async (course) => {
			const home: HomeCourse = {
				href: courseHref({
					discipline: course.discipline.slug,
					instructor: course.instructor.username,
					edition: course.edition.slug,
				}),
				code: course.discipline.slug,
				name: course.discipline.name,
				edition: repeated.has(course.discipline.slug)
					? course.edition.slug
					: undefined,
			};
			const [exams, attempts, feedback, questions, exceptions, open, policyOf] =
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
					loadResultPolicy(course.id),
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
							policyOf(exam),
						),
					})),
			}));
			const [rollCalls, openReports] = only
				? [[], 0]
				: await Promise.all([
						db.rollCall.findMany({ course: course.id }, { actor }),
						db.report.countOpen(course.id, { actor }),
					]);
			const taughtCourse: TaughtCourse = {
				course: home,
				questionsWithProblems: questions.filter(
					({ question }) => questionProblems(question).length > 0,
				).length,
				openReports,
			};
			const regrades: ExamRegrades[] = exams.map((exam) => ({
				course: home,
				exam,
				requests: open.filter((request) => request.exam === exam.slug),
			}));
			return { course, home, taughtExams, taughtCourse, regrades, rollCalls };
		}),
	);

	const events =
		only || courses.length === 0
			? []
			: await db.calendarEvent.findMany(
					{
						courseIds: courses.map((course) => course.id),
						from: startOfLocalDay(now),
					},
					{ actor },
				);
	const byCourse = new Map(loaded.map((entry) => [entry.course.id, entry]));
	const taughtEvents: TaughtEvent[] = events.flatMap((event) => {
		const entry = byCourse.get(event.courseId);
		if (!entry) return [];
		const rollCall = entry.rollCalls.find(
			(r) => r.week === event.week && r.timeSlot === event.timeSlot.slug,
		);
		return [
			{
				course: entry.home,
				title: event.title,
				kind: event.kind,
				startAt: event.startAt,
				endsAt: new Date(
					event.startAt.getTime() +
						durationToMinutes(event.timeSlot.duration) * 60_000,
				),
				meeting: {
					discipline: entry.course.discipline.slug,
					course: `${entry.course.instructor.username}_${entry.course.edition.slug}`,
					week: event.week,
					timeSlot: event.timeSlot.slug,
				},
				rollCallClosesAt: rollCall?.closesAt ?? null,
			},
		];
	});

	return {
		...instructorHome(
			loaded.flatMap(({ taughtExams }) => taughtExams),
			loaded.map(({ taughtCourse }) => taughtCourse),
			now,
			taughtEvents,
		),
		regrades: regradeQueue(loaded.flatMap(({ regrades }) => regrades)),
	};
}
