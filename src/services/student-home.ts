/**
 * What a student's home page leads with, decided from data the caller already fetched.
 *
 * Pure: the page loads the student's courses, exams, attempts, released results
 * and calendar events, and this picks what needs their attention at `now`.
 */

import type { Exam, RegradeRequest } from "@/db";
import { localDateOf } from "@/utils/schedule-time";
import type { ExamResult } from "./exam-result";
import {
	type AttemptTiming,
	attemptState,
	type ExceptionTiming,
	examPhase,
	personalTiming,
	releaseMoment,
	windowEnd,
} from "./exam-state";

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
	/// The student's own exception on this exam. Absent means none.
	exception?: ExceptionTiming | null;
	/**
	 * Every exception of the exam, used only to decide whether and when
	 * results are released ({@link resultsReleased}, {@link releaseMoment}).
	 * Loaded by a trusted actor, since a student cannot read other students'
	 * exceptions; never shown. Absent means none.
	 */
	exceptions?: readonly ExceptionTiming[];
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
 * what has a deadline. An exam counts as a recent result by its
 * {@link releaseMoment}, so one released with no known moment never does.
 *
 * Each exam is placed by the student's personal timing (`openNow`,
 * `upcoming`, `next` and their dates, from `personalTiming(exam, exception)`),
 * while release is decided on the exam's own timing and `exceptions`. The
 * returned `exam` is always the exam itself, not the personal timing.
 */
export function studentHome(
	exams: HomeExam[],
	events: HomeEvent[],
	now: Date,
): StudentHome {
	const visible = exams
		.filter(({ exam }) => exam.type !== "PRACTICE")
		.map((entry) => ({
			...entry,
			personal: personalTiming(entry.exam, entry.exception ?? null),
		}))
		.filter(
			({ personal }) =>
				!["draft", "archived"].includes(examPhase(personal, now)),
		);

	const openNow = visible
		.flatMap(({ course, exam, personal, attempt }) => {
			const state = attemptState(personal, attempt, now);
			if (state.kind === "can-start") {
				return [
					{ course, exam, deadline: windowEnd(personal), started: false },
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
		.filter(({ personal }) => examPhase(personal, now) === "upcoming")
		.flatMap(({ course, exam, personal }) =>
			personal.scheduledAt &&
			personal.scheduledAt >= now &&
			personal.scheduledAt.getTime() <= horizon
				? [{ course, exam, opensAt: personal.scheduledAt }]
				: [],
		)
		.sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime());

	const today = events
		.filter((event) => localDateOf(event.startAt) === localDateOf(now))
		.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

	const since = now.getTime() - HOME_HORIZON_MS;
	const results = visible
		.flatMap(({ course, exam, attempt, result, exceptions = [] }) => {
			const releasedAt = releaseMoment(exam, now, exceptions);
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

/// Orders dates ascending with `null` last.
function compareNullsLast(a: Date | null, b: Date | null): number {
	if (a === null || b === null) return Number(a === null) - Number(b === null);
	return a.getTime() - b.getTime();
}

/// The earliest event or exam start after `now`, however far ahead.
function nextThing(
	exams: { course: HomeCourse; exam: Exam; personal: Exam }[],
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
		...exams.flatMap(({ course, exam, personal }) =>
			personal.scheduledAt && personal.scheduledAt > now
				? [{ kind: "exam" as const, course, exam, at: personal.scheduledAt }]
				: [],
		),
	];
	candidates.sort((a, b) => a.at.getTime() - b.at.getTime());
	return candidates[0] ?? null;
}

/// One of the student's regrade requests, with the course and exam it belongs to.
export interface HomeRegrade {
	course: HomeCourse;
	exam: Exam;
	request: Pick<
		RegradeRequest,
		"publicId" | "question" | "status" | "reply" | "resolvedAt"
	>;
}

/**
 * The student's requests resolved within the last {@link HOME_HORIZON_MS}, newest resolution first, shown next to `results`.
 *
 * A request counts when its status is `ACCEPTED` or `REJECTED` and its
 * `resolvedAt` is neither before `now - HOME_HORIZON_MS` nor after `now`.
 */
export function recentRegrades(
	regrades: readonly HomeRegrade[],
	now: Date,
): HomeRegrade[] {
	const since = now.getTime() - HOME_HORIZON_MS;
	const resolvedAt = (entry: HomeRegrade) => entry.request.resolvedAt;
	return regrades
		.filter(({ request }) => {
			const at = request.resolvedAt?.getTime();
			return (
				request.status !== "OPEN" &&
				at !== undefined &&
				at >= since &&
				at <= now.getTime()
			);
		})
		.sort(
			(a, b) =>
				(resolvedAt(b)?.getTime() ?? 0) - (resolvedAt(a)?.getTime() ?? 0),
		);
}
