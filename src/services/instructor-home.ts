/**
 * What an instructor's home page leads with, across every course they teach.
 *
 * Pure: the page loads the taught courses, their exams, every student's
 * attempt with its result, and the question bank's problems; this picks what
 * needs the instructor at `now`.
 */

import type { AttemptTiming, Exam } from "@/db";
import { attemptState, examPhase, windowEnd } from "@/db/exam-state";
import type { ExamResult } from "./exam-result";
import type { HomeCourse } from "./student-home";

/// One exam of a course the instructor teaches, with every student's attempt.
export interface TaughtExam {
	course: HomeCourse;
	exam: Exam;
	/// Students actively enrolled in the course.
	enrolled: number;
	/// Every student's graded attempt, each with its result as the instructor sees it (all feedback, released or not).
	attempts: { attempt: AttemptTiming; result: ExamResult }[];
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
	/// `EXAM` exams that are closed, unreleased, have at least one attempt and nothing pending.
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
		.filter(({ exam }) => examPhase(exam, now) === "open")
		.map(({ course, exam, enrolled, attempts }) => {
			const kinds = attempts.map(
				({ attempt }) => attemptState(exam, attempt, now).kind,
			);
			return {
				course,
				exam,
				started: kinds.filter((kind) => kind === "in-progress").length,
				submitted: kinds.filter(isClosed).length,
				enrolled,
				closesAt: windowEnd(exam),
			};
		})
		.sort((a, b) => {
			if (a.closesAt === null || b.closesAt === null) {
				return Number(a.closesAt === null) - Number(b.closesAt === null);
			}
			return a.closesAt.getTime() - b.closesAt.getTime();
		});

	const toGrade = shown
		.map(({ course, exam, attempts }) => ({
			course,
			exam,
			pending: attempts
				.filter(({ attempt }) =>
					isClosed(attemptState(exam, attempt, now).kind),
				)
				.reduce((sum, { result }) => sum + pendingIn(result), 0),
		}))
		.filter((item) => item.pending > 0)
		.sort((a, b) => b.pending - a.pending);

	const toRelease = shown
		.filter(
			({ exam, attempts }) =>
				exam.type === "EXAM" &&
				examPhase(exam, now) === "closed" &&
				!exam.gradesReleasedAt &&
				attempts.length > 0 &&
				attempts.every(({ result }) => pendingIn(result) === 0),
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

/// Whether an attempt state means the student can no longer answer.
function isClosed(kind: string): boolean {
	return kind === "submitted" || kind === "results";
}

/// How many answered questions of one attempt have no verdict yet.
function pendingIn(result: ExamResult): number {
	return result.questions.filter((outcome) => outcome.status === "pending")
		.length;
}
