/**
 * What an instructor's home page leads with, across every course they teach.
 *
 * Pure: the page loads the taught courses, their exams, every student's
 * attempt with its result, and the question bank's problems; this picks what
 * needs the instructor at `now`.
 */

import type { Exam, RegradeRequest } from "@/db";
import { localDateOf } from "@/utils/schedule-time";
import type { ExamResult } from "./exam-result";
import {
	type AttemptTiming,
	attemptOf,
	type ExamSchedule,
	type ExceptionTiming,
	examPhase,
	examSchedule,
	hiddenFromStudents,
	isFinished,
	lastWindowEnd,
	openWindowAuthors,
	releaseBlocker,
	timingFor,
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
	/// Content reports nobody has triaged yet.
	openReports?: number;
}

/// One calendar event of a course the instructor teaches.
export interface TaughtEvent {
	course: HomeCourse;
	title: string;
	kind: string;
	startAt: Date;
	endsAt: Date;
	/// Where the roll call actions find the meeting: the course's URL segments, its week and time slot.
	meeting: {
		discipline: string;
		course: string;
		week: number;
		timeSlot: string;
	};
	/// When the meeting's roll call stops taking check-ins, or `null` if it has none.
	rollCallClosesAt: Date | null;
}

/// A meeting on the home page, with what the instructor can do about its roll call at `now`.
export interface HomeMeeting extends TaughtEvent {
	rollCall: "none" | "open" | "closed";
	/// Whether `now` falls between the meeting's start and end.
	inMeeting: boolean;
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
		/// Once the exam's own window has closed, the students whose personal window is still upcoming or open; `0` before.
		personalWindows: number;
		/// The window end, or `null` for an exam without one.
		closesAt: Date | null;
	}[];
	/// Exams with submitted attempts that still have answers without a verdict, most pending first.
	toGrade: { course: HomeCourse; exam: Exam; pending: number }[];
	/// Exams with at least one attempt whose grades the instructor may release now.
	toRelease: { course: HomeCourse; exam: Exam; attempts: number }[];
	/// Courses whose question bank has validation problems.
	problems: { course: HomeCourse; questions: number }[];
	/// Courses with content reports nobody has triaged yet.
	reports: { course: HomeCourse; open: number }[];
	/// Meetings on the same calendar day as `now` (server time zone), earliest first.
	today: HomeMeeting[];
	/// When every list above is empty, the next meeting or exam ahead, however far; otherwise `null`.
	next:
		| { kind: "exam"; course: HomeCourse; exam: Exam; at: Date }
		| { kind: "event"; course: HomeCourse; event: TaughtEvent; at: Date }
		| null;
}

/**
 * Builds the instructor's home page sections at `now`.
 *
 * An answer counts as pending only once its attempt is closed to answers; an
 * attempt still in progress is not grading work yet. `DRAFT` and `ARCHIVED`
 * exams never appear.
 *
 * With exceptions, each attempt is judged by its author's personal timing.
 * An exam that has opened stays in `inProgress` while any personal window is
 * `open` or `upcoming`, with `closesAt` at {@link lastWindowEnd}; `toRelease` asks
 * {@link gradeReleaseBlocker} with the exceptions, so a pending makeup keeps
 * the exam out of it.
 */
export function instructorHome(
	exams: TaughtExam[],
	courses: TaughtCourse[],
	now: Date,
	events: TaughtEvent[] = [],
): InstructorHome {
	const shown = exams
		.filter(
			({ exam }) =>
				exam.type !== "PRACTICE" && !hiddenFromStudents(exam.status),
		)
		.map((taught) => ({
			...taught,
			schedule: examSchedule(taught.exam, taught.exceptions),
		}));

	const inProgress = shown
		.map((taught) => ({
			...taught,
			personalWindows: personalWindowsOf(taught.schedule, now),
		}))
		.filter(
			({ exam, schedule, personalWindows }) =>
				examPhase(exam, now) === "open" ||
				personalWindows > 0 ||
				[...schedule.exceptions.entries()].some(
					([author, exception]) =>
						!exception.dropped &&
						examPhase(timingFor(schedule, author), now) === "open",
				),
		)
		.map(({ course, exam, enrolled, attempts, schedule, personalWindows }) => {
			const states = attempts.map(({ attempt }) =>
				attemptOf(schedule, attempt.author ?? null, attempt, now),
			);
			return {
				course,
				exam,
				started: states.filter((state) => state.kind === "in-progress").length,
				submitted: states.filter(isFinished).length,
				enrolled,
				personalWindows,
				closesAt: lastWindowEnd(schedule),
			};
		})
		.sort((a, b) => {
			if (a.closesAt === null || b.closesAt === null) {
				return Number(a.closesAt === null) - Number(b.closesAt === null);
			}
			return a.closesAt.getTime() - b.closesAt.getTime();
		});

	const toGrade = shown
		.map(({ course, exam, attempts, schedule }) => ({
			course,
			exam,
			pending: attempts
				.filter(({ attempt }) =>
					isFinished(attemptOf(schedule, attempt.author ?? null, attempt, now)),
				)
				.reduce((sum, { result }) => sum + pendingIn(result), 0),
		}))
		.filter((item) => item.pending > 0)
		.sort((a, b) => b.pending - a.pending);

	const toRelease = shown
		.filter(
			({ schedule, attempts }) =>
				attempts.length > 0 &&
				releaseBlocker(
					schedule,
					attempts.map(({ result }) => result),
					now,
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

	const reports = courses
		.filter(({ openReports = 0 }) => openReports > 0)
		.map(({ course, openReports = 0 }) => ({ course, open: openReports }));

	const today = events
		.filter((event) => localDateOf(event.startAt) === localDateOf(now))
		.sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
		.map((event) => ({
			...event,
			rollCall: rollCallState(event.rollCallClosesAt, now),
			inMeeting: event.startAt <= now && now < event.endsAt,
		}));

	const busy = [inProgress, toGrade, toRelease, problems, reports, today].some(
		(list) => list.length > 0,
	);
	return {
		inProgress,
		toGrade,
		toRelease,
		problems,
		reports,
		today,
		next: busy ? null : nextTaught(shown, events, now),
	};
}

/// Whether a roll call closing at `closesAt` is missing, still open, or closed at `now`.
function rollCallState(
	closesAt: Date | null,
	now: Date,
): HomeMeeting["rollCall"] {
	if (!closesAt) return "none";
	return closesAt > now ? "open" : "closed";
}

/// The earliest meeting or exam start after `now`, however far ahead.
function nextTaught(
	exams: TaughtExam[],
	events: TaughtEvent[],
	now: Date,
): InstructorHome["next"] {
	const candidates: NonNullable<InstructorHome["next"]>[] = [
		...events
			.filter((event) => event.startAt > now)
			.map((event) => ({
				kind: "event" as const,
				course: event.course,
				event,
				at: event.startAt,
			})),
		...exams.flatMap(({ course, exam }) =>
			exam.scheduledAt && exam.scheduledAt > now
				? [{ kind: "exam" as const, course, exam, at: exam.scheduledAt }]
				: [],
		),
	];
	candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
	return candidates[0] ?? null;
}

/// After the exam's own window closed, how many students still have a personal window upcoming or open at `now`.
function personalWindowsOf(schedule: ExamSchedule, now: Date): number {
	if (examPhase(schedule.base, now) !== "closed") return 0;
	return openWindowAuthors(schedule, now).length;
}

/// How many answered questions of one attempt have no verdict yet.
function pendingIn(result: ExamResult): number {
	return result.questions.filter((outcome) => outcome.status === "pending")
		.length;
}

/// The regrade requests of one exam of a course the instructor teaches, any status.
export interface ExamRegrades {
	course: HomeCourse;
	exam: Exam;
	requests: readonly Pick<RegradeRequest, "status" | "createdAt">[];
}

/// One exam waiting on the instructor to resolve regrade requests.
export interface RegradeQueueItem {
	course: HomeCourse;
	exam: Exam;
	/// How many of its requests are `OPEN`, at least one.
	open: number;
	/// When the oldest `OPEN` request was made.
	oldest: Date;
}

/**
 * The exams with `OPEN` regrade requests, the home page's `regrades` list, shown next to `toGrade`.
 *
 * Exams with no open request are left out. Most open requests first; a tie
 * goes to the exam whose oldest open request is older.
 */
export function regradeQueue(
	exams: readonly ExamRegrades[],
): RegradeQueueItem[] {
	const items = exams.flatMap(({ course, exam, requests }) => {
		const open = requests.filter((request) => request.status === "OPEN");
		const oldest = open.reduce<Date | null>(
			(min, { createdAt }) => (!min || createdAt < min ? createdAt : min),
			null,
		);
		return oldest ? [{ course, exam, open: open.length, oldest }] : [];
	});
	return items.sort(
		(a, b) => b.open - a.open || a.oldest.getTime() - b.oldest.getTime(),
	);
}
