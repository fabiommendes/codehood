/**
 * What an instructor's home page leads with, across every course they teach.
 *
 * Pure: the page loads the taught courses, their exams, every student's
 * attempt with its result, and the question bank's problems; this picks what
 * needs the instructor at `now`.
 */

import type { Exam } from "@/db";
import type { ExamResult } from "./exam-result";
import {
	type AttemptTiming,
	attemptState,
	type ExceptionTiming,
	examPhase,
	gradeReleaseBlocker,
	lastWindowEnd,
	personalTiming,
} from "./exam-state";
import type { HomeCourse } from "./student-home";

/// One exam of a course the instructor teaches, with every student's attempt.
export interface TaughtExam {
	course: HomeCourse;
	exam: Exam;
	/// Students actively enrolled in the course.
	enrolled: number;
	/// Every student's graded attempt, each with its result as the instructor sees it (all feedback, released or not).
	/// `author` picks the student's exception; an attempt without one is judged by the exam's own timing.
	attempts: {
		attempt: AttemptTiming & { author?: string };
		result: ExamResult;
	}[];
	/// The exam's exceptions, by username. Absent means none.
	exceptions?: ReadonlyMap<string, ExceptionTiming>;
}

/// One course the instructor teaches, with the state of its question bank.
export interface TaughtCourse {
	course: HomeCourse;
	/// Questions whose document fails validation.
	questionsWithProblems: number;
}

export interface InstructorHome {
	/// Non-practice exams whose phase is `open`, soonest closing first (undated last).
	inProgress: {
		course: HomeCourse;
		exam: Exam;
		/// Attempts still being answered.
		started: number;
		/// Attempts closed to answers (submitted, or past their deadline).
		submitted: number;
		enrolled: number;
		/// The window end, or `null` for an exam without one.
		closesAt: Date | null;
	}[];
	/// Exams with submitted attempts that still have answers without a verdict, most pending first.
	toGrade: { course: HomeCourse; exam: Exam; pending: number }[];
	/// Exams with at least one attempt whose grades the instructor may release now.
	toRelease: { course: HomeCourse; exam: Exam; attempts: number }[];
	/// Courses whose question bank has validation problems.
	problems: { course: HomeCourse; questions: number }[];
}

/**
 * Builds the instructor's home page sections at `now`.
 *
 * An answer counts as pending only once its attempt is closed to answers; an
 * attempt still in progress is not grading work yet. `DRAFT` and `ARCHIVED`
 * exams never appear.
 *
 * With exceptions, each attempt is judged by its author's personal timing.
 * An exam stays in `inProgress` while any personal window is `open` or
 * `upcoming`, with `closesAt` at {@link lastWindowEnd}; `toRelease` asks
 * {@link gradeReleaseBlocker} with the exceptions, so a pending makeup keeps
 * the exam out of it.
 */
export function instructorHome(
	exams: TaughtExam[],
	courses: TaughtCourse[],
	now: Date,
): InstructorHome {
	const shown = exams.filter(({ exam }) => {
		const phase = examPhase(exam, now);
		return (
			exam.type !== "PRACTICE" && phase !== "draft" && phase !== "archived"
		);
	});

	const inProgress = shown
		.filter(
			({ exam, exceptions }) =>
				examPhase(exam, now) === "open" ||
				[...(exceptions?.values() ?? [])].some((exception) =>
					isPersonallyOpen(exam, exception, now),
				),
		)
		.map(({ course, exam, enrolled, attempts, exceptions }) => {
			const kinds = attempts.map(
				({ attempt }) =>
					attemptState(
						personalTiming(exam, exceptions?.get(attempt.author ?? "") ?? null),
						attempt,
						now,
					).kind,
			);
			return {
				course,
				exam,
				started: kinds.filter((kind) => kind === "in-progress").length,
				submitted: kinds.filter(isClosed).length,
				enrolled,
				closesAt: lastWindowEnd(exam, [...(exceptions?.values() ?? [])]),
			};
		})
		.sort((a, b) => {
			if (a.closesAt === null || b.closesAt === null) {
				return Number(a.closesAt === null) - Number(b.closesAt === null);
			}
			return a.closesAt.getTime() - b.closesAt.getTime();
		});

	const toGrade = shown
		.map(({ course, exam, attempts, exceptions }) => ({
			course,
			exam,
			pending: attempts
				.filter(({ attempt }) =>
					isClosed(
						attemptState(
							personalTiming(
								exam,
								exceptions?.get(attempt.author ?? "") ?? null,
							),
							attempt,
							now,
						).kind,
					),
				)
				.reduce((sum, { result }) => sum + pendingIn(result), 0),
		}))
		.filter((item) => item.pending > 0)
		.sort((a, b) => b.pending - a.pending);

	const toRelease = shown
		.filter(
			({ exam, attempts, exceptions }) =>
				attempts.length > 0 &&
				gradeReleaseBlocker(
					exam,
					attempts.map(({ result }) => result),
					now,
					[...(exceptions?.values() ?? [])],
				) === null,
		)
		.map(({ course, exam, attempts }) => ({
			course,
			exam,
			attempts: attempts.length,
		}));

	const problems = courses
		.filter(({ questionsWithProblems }) => questionsWithProblems > 0)
		.map(({ course, questionsWithProblems }) => ({
			course,
			questions: questionsWithProblems,
		}));

	return { inProgress, toGrade, toRelease, problems };
}

/// Whether the personal window of `exception` is still upcoming or open at `now`.
function isPersonallyOpen(
	exam: Exam,
	exception: ExceptionTiming,
	now: Date,
): boolean {
	if (exception.dropped) return false;
	const phase = examPhase(personalTiming(exam, exception), now);
	return phase === "upcoming" || phase === "open";
}

/// Whether an attempt state means the student can no longer answer.
function isClosed(kind: string): boolean {
	return kind === "submitted" || kind === "results";
}

/// How many answered questions of one attempt have no verdict yet.
function pendingIn(result: ExamResult): number {
	return result.questions.filter((outcome) => outcome.status === "pending")
		.length;
}
