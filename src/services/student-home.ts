/**
 * What a student's home page leads with, decided from data the caller already fetched.
 *
 * Pure: the page loads the student's courses, exams, attempts, released results
 * and calendar events, and this picks what needs their attention at `now`.
 */

import type { AttemptTiming, Exam } from "@/db";
import { attemptDeadline, attemptState, examPhase } from "@/db/exam-state";
import { localDateOf } from "@/utils/schedule-time";
import type { ExamResult } from "./exam-result";

/// How far ahead an exam counts as coming up, and how far back a release counts as new.
export const HOME_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;

/// A course as the home page labels and links it.
export interface HomeCourse {
	/// The course URL, e.g. `/cs101/ada_2026-1`.
	href: string;
	/// The discipline code, e.g. `cs101`.
	code: string;
	name: string;
}

/// One exam of a course the student takes, with the student's own attempt.
export interface HomeExam {
	course: HomeCourse;
	exam: Exam;
	attempt: AttemptTiming | null;
	/// The student's graded result, or `null` when the exam has not released results.
	result: ExamResult | null;
}

/// One calendar event of a course the student takes.
export interface HomeEvent {
	course: HomeCourse;
	title: string;
	kind: string;
	startAt: Date;
}

export interface StudentHome {
	/// Graded exams the student can start or is taking now, soonest deadline first.
	openNow: {
		course: HomeCourse;
		exam: Exam;
		deadline: Date | null;
		started: boolean;
	}[];
	/// Graded exams opening within {@link HOME_HORIZON_MS}, soonest first.
	upcoming: { course: HomeCourse; exam: Exam; opensAt: Date }[];
	/// Events on the same calendar day as `now` (server time zone), earliest first.
	today: HomeEvent[];
	/// Results released within the last {@link HOME_HORIZON_MS} on exams the student took, newest release first.
	results: {
		course: HomeCourse;
		exam: Exam;
		total: number | null;
		releasedAt: Date;
	}[];
	/// When the four lists above are all empty, the next dated thing ahead, however far; otherwise `null`.
	next:
		| { kind: "exam"; course: HomeCourse; exam: Exam; at: Date }
		| { kind: "event"; course: HomeCourse; event: HomeEvent; at: Date }
		| null;
}

/**
 * Builds the student's home page sections at `now`.
 *
 * `PRACTICE` exams never appear: they are always open and would crowd out
 * what has a deadline. An exam's release moment is `gradesReleasedAt` for an
 * `EXAM` and the end of its window for a `QUIZ`.
 */
export function studentHome(
	exams: HomeExam[],
	events: HomeEvent[],
	now: Date,
): StudentHome {
	const graded = exams.filter(({ exam }) => exam.type !== "PRACTICE");
	const visible = graded.filter(
		({ exam }) => !["draft", "archived"].includes(examPhase(exam, now)),
	);

	const openNow = visible
		.flatMap(({ course, exam, attempt }) => {
			const state = attemptState(exam, attempt, now);
			if (state.kind === "can-start") {
				return [
					{ course, exam, deadline: windowEnd(exam, now), started: false },
				];
			}
			if (state.kind === "in-progress") {
				return [{ course, exam, deadline: state.deadline, started: true }];
			}
			return [];
		})
		.sort((a, b) => compareNullsLast(a.deadline, b.deadline));

	const horizon = now.getTime() + HOME_HORIZON_MS;
	const upcoming = visible
		.filter(({ exam }) => examPhase(exam, now) === "upcoming")
		.flatMap(({ course, exam }) =>
			exam.scheduledAt &&
			exam.scheduledAt >= now &&
			exam.scheduledAt.getTime() <= horizon
				? [{ course, exam, opensAt: exam.scheduledAt }]
				: [],
		)
		.sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());

	const today = events
		.filter((event) => localDateOf(event.startAt) === localDateOf(now))
		.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

	const since = now.getTime() - HOME_HORIZON_MS;
	const results = visible
		.flatMap(({ course, exam, attempt, result }) => {
			const releasedAt = releaseMoment(exam, now);
			if (!attempt || !result || !releasedAt) return [];
			const at = releasedAt.getTime();
			if (at < since || at > now.getTime()) return [];
			return [{ course, exam, total: result.total, releasedAt }];
		})
		.sort((a, b) => b.releasedAt.getTime() - a.releasedAt.getTime());

	const busy = [openNow, upcoming, today, results].some(
		(list) => list.length > 0,
	);
	return {
		openNow,
		upcoming,
		today,
		results,
		next: busy ? null : nextThing(visible, events, now),
	};
}

/// When a scheduled, timed exam closes for everyone, or `null` when it has no such window.
function windowEnd(exam: Exam, now: Date): Date | null {
	if (!exam.scheduledAt) return null;
	return attemptDeadline(exam, { createdAt: now, acceptingSubmissions: true });
}

/// When the exam's results became visible: `gradesReleasedAt`, or the window end for a `QUIZ`.
function releaseMoment(exam: Exam, now: Date): Date | null {
	if (exam.type === "QUIZ") return windowEnd(exam, now);
	return exam.gradesReleasedAt ?? null;
}

/// Orders dates ascending with `null` last.
function compareNullsLast(a: Date | null, b: Date | null): number {
	if (a === null || b === null) return Number(a === null) - Number(b === null);
	return a.getTime() - b.getTime();
}

/// The earliest event or exam start after `now`, however far ahead.
function nextThing(
	exams: HomeExam[],
	events: HomeEvent[],
	now: Date,
): StudentHome["next"] {
	const candidates: NonNullable<StudentHome["next"]>[] = [
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
