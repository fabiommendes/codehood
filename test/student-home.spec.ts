import { expect, test } from "@playwright/test";
import type { Exam } from "@/db";
import type { ExamResult } from "@/services/exam-result";
import {
	HOME_HORIZON_MS,
	type HomeCourse,
	type HomeEvent,
	type HomeExam,
	studentHome,
} from "@/services/student-home";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/// Built with the local-time constructor: "today" is a calendar day of the server zone.
const NOW = new Date(2026, 2, 10, 14, 0);

/// `NOW` shifted by `ms`.
function at(ms: number): Date {
	return new Date(NOW.getTime() + ms);
}

const algebra: HomeCourse = {
	href: "/mat101/ada_2026-1",
	code: "mat101",
	name: "Algebra",
};
const compilers: HomeCourse = {
	href: "/cs301/alan_2026-1",
	code: "cs301",
	name: "Compilers",
};

let nextId = 1;

/** A minimal, valid `Exam` literal: override only the fields a case cares about. */
function exam(overrides: Partial<Exam> = {}): Exam {
	const id = nextId++;
	return {
		id: id as Exam["id"],
		slug: `exam-${id}`,
		type: "EXAM",
		status: "SCHEDULED",
		title: `Exam ${id}`,
		description: null,
		preamble: null,
		format: "PLAINTEXT",
		scheduledAt: null,
		duration: null,
		extraTime: null,
		gradesReleasedAt: null,
		author: "instructor",
		rev: null,
		tags: [],
		questions: [],
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function homeExam(
	e: Exam,
	extra: Partial<Omit<HomeExam, "exam">> = {},
): HomeExam {
	return { course: algebra, exam: e, attempt: null, result: null, ...extra };
}

function event(
	title: string,
	startAt: Date,
	course: HomeCourse = algebra,
): HomeEvent {
	return { course, title, kind: "CLASS", startAt };
}

function result(total: number | null): ExamResult {
	return { questions: [], total };
}

/// An exam open right now: scheduled 10 minutes ago, 60 minutes long, so it ends at `NOW + 50m`.
function openExam(overrides: Partial<Exam> = {}): Exam {
	return exam({
		scheduledAt: at(-10 * MINUTE),
		duration: { minutes: 60 },
		...overrides,
	});
}

const titlesOf = (items: { exam: Exam }[]) => items.map((i) => i.exam.title);

test("HOME_HORIZON_MS is seven days", () => {
	expect(HOME_HORIZON_MS).toBe(7 * DAY);
});

test("studentHome: nothing at all yields empty sections and no next item", () => {
	expect(studentHome([], [], NOW)).toEqual({
		openNow: [],
		upcoming: [],
		today: [],
		results: [],
		next: null,
	});
});

//
// openNow
//

test("openNow: an open exam not yet started is listed with started false and the window end as deadline", () => {
	const midterm = openExam({ title: "Midterm" });

	const home = studentHome([homeExam(midterm)], [], NOW);

	expect(home.openNow).toEqual([
		{
			course: algebra,
			exam: midterm,
			deadline: at(50 * MINUTE),
			started: false,
		},
	]);
});

test("openNow: extra time pushes the deadline of a not-yet-started exam", () => {
	const midterm = openExam({ extraTime: { minutes: 15 } });

	const home = studentHome([homeExam(midterm)], [], NOW);

	expect(home.openNow[0]?.deadline).toEqual(at(65 * MINUTE));
});

test("openNow: an open exam with no duration has a null deadline", () => {
	const untimed = exam({ status: "ONGOING", title: "Untimed" });

	const home = studentHome([homeExam(untimed)], [], NOW);

	expect(home.openNow).toEqual([
		{ course: algebra, exam: untimed, deadline: null, started: false },
	]);
});

test("openNow: an attempt in progress is started, with the deadline counted from its start", () => {
	const timed = exam({
		status: "ONGOING",
		duration: { minutes: 60 },
		title: "Take-home",
	});
	const attempt = { createdAt: at(-20 * MINUTE), acceptingSubmissions: true };

	const home = studentHome([homeExam(timed, { attempt })], [], NOW);

	expect(home.openNow).toEqual([
		{
			course: algebra,
			exam: timed,
			deadline: at(40 * MINUTE),
			started: true,
		},
	]);
});

test("openNow: sorted by deadline ascending, with null deadlines last", () => {
	const noLimit = exam({ status: "ONGOING", title: "No limit" });
	const late = openExam({ title: "Late", duration: { minutes: 180 } });
	const soon = openExam({ title: "Soon", duration: { minutes: 30 } });

	const home = studentHome(
		[homeExam(noLimit), homeExam(late), homeExam(soon)],
		[],
		NOW,
	);

	expect(titlesOf(home.openNow)).toEqual(["Soon", "Late", "No limit"]);
});

test("openNow: exams of several courses are mixed in one list", () => {
	const a = openExam({ title: "A", duration: { minutes: 90 } });
	const b = openExam({ title: "B", duration: { minutes: 30 } });

	const home = studentHome(
		[homeExam(a), homeExam(b, { course: compilers })],
		[],
		NOW,
	);

	expect(home.openNow.map((i) => [i.exam.title, i.course.code])).toEqual([
		["B", "cs301"],
		["A", "mat101"],
	]);
});

test("openNow: PRACTICE exams never appear", () => {
	const drill = openExam({ type: "PRACTICE", title: "Drill" });

	const home = studentHome([homeExam(drill)], [], NOW);

	expect(home.openNow).toEqual([]);
});

test("openNow: an attempt that was submitted is not open any more", () => {
	const midterm = openExam();
	const attempt = { createdAt: at(-5 * MINUTE), acceptingSubmissions: false };

	const home = studentHome([homeExam(midterm, { attempt })], [], NOW);

	expect(home.openNow).toEqual([]);
});

test("openNow: an exam whose window ended, upcoming or missed, is not open", () => {
	const missed = exam({
		scheduledAt: at(-3 * HOUR),
		duration: { minutes: 60 },
	});
	const later = exam({ scheduledAt: at(2 * DAY) });

	const home = studentHome([homeExam(missed), homeExam(later)], [], NOW);

	expect(home.openNow).toEqual([]);
});

test("draft and archived exams appear in no section", () => {
	const drafts = (["DRAFT", "ARCHIVED"] as const).flatMap((status) => [
		// Would be open now
		homeExam(openExam({ status })),
		// Would be coming up
		homeExam(exam({ status, scheduledAt: at(DAY) })),
		// Would be a fresh result
		homeExam(
			exam({
				status,
				gradesReleasedAt: at(-DAY),
			}),
			{
				attempt: { createdAt: at(-2 * DAY), acceptingSubmissions: false },
				result: result(1),
			},
		),
	]);

	const home = studentHome(drafts, [], NOW);

	expect(home.openNow).toEqual([]);
	expect(home.upcoming).toEqual([]);
	expect(home.results).toEqual([]);
	expect(home.next).toBeNull();
});

//
// upcoming
//

test("upcoming: an exam opening within the horizon is listed with opensAt", () => {
	const final = exam({ title: "Final", scheduledAt: at(2 * DAY) });

	const home = studentHome([homeExam(final)], [], NOW);

	expect(home.upcoming).toEqual([
		{ course: algebra, exam: final, opensAt: at(2 * DAY) },
	]);
});

test("upcoming: an exam opening exactly at the horizon is included, one ms beyond is not", () => {
	const edge = exam({ title: "Edge", scheduledAt: at(HOME_HORIZON_MS) });
	const beyond = exam({
		title: "Beyond",
		scheduledAt: at(HOME_HORIZON_MS + 1),
	});

	const home = studentHome([homeExam(edge), homeExam(beyond)], [], NOW);

	expect(titlesOf(home.upcoming)).toEqual(["Edge"]);
});

test("upcoming: an exam opening one ms from now is included; one that opens exactly now is open, not upcoming", () => {
	const imminent = exam({ title: "Imminent", scheduledAt: at(1) });
	const now = exam({ title: "Now", scheduledAt: at(0) });

	const home = studentHome([homeExam(imminent), homeExam(now)], [], NOW);

	expect(titlesOf(home.upcoming)).toEqual(["Imminent"]);
	expect(titlesOf(home.openNow)).toEqual(["Now"]);
});

test("upcoming: an exam without a date is not listed", () => {
	const undated = exam({ title: "Undated" });

	const home = studentHome([homeExam(undated)], [], NOW);

	expect(home.upcoming).toEqual([]);
});

test("upcoming: PRACTICE exams never appear", () => {
	const drill = exam({
		type: "PRACTICE",
		status: "SCHEDULED",
		scheduledAt: at(DAY),
	});

	const home = studentHome([homeExam(drill)], [], NOW);

	expect(home.upcoming).toEqual([]);
});

test("upcoming: sorted by scheduledAt, soonest first", () => {
	const third = exam({ title: "Third", scheduledAt: at(5 * DAY) });
	const first = exam({ title: "First", scheduledAt: at(1 * DAY) });
	const second = exam({ title: "Second", scheduledAt: at(3 * DAY) });

	const home = studentHome(
		[homeExam(third), homeExam(first), homeExam(second)],
		[],
		NOW,
	);

	expect(titlesOf(home.upcoming)).toEqual(["First", "Second", "Third"]);
});

//
// today
//

test("today: events on the same calendar day as now, earliest first, including ones already started", () => {
	const evening = event("Evening lab", new Date(2026, 2, 10, 19, 0));
	const morning = event("Morning class", new Date(2026, 2, 10, 8, 0));
	const midnight = event("Midnight", new Date(2026, 2, 10, 0, 0));
	const lateNight = event("Late night", new Date(2026, 2, 10, 23, 59, 59));

	const home = studentHome([], [evening, lateNight, morning, midnight], NOW);

	expect(home.today.map((e) => e.title)).toEqual([
		"Midnight",
		"Morning class",
		"Evening lab",
		"Late night",
	]);
});

test("today: events of yesterday and tomorrow are left out", () => {
	const yesterday = event("Yesterday", new Date(2026, 2, 9, 23, 59, 59));
	const tomorrow = event("Tomorrow", new Date(2026, 2, 11, 0, 0));
	const today = event("Today", new Date(2026, 2, 10, 9, 0));

	const home = studentHome([], [yesterday, tomorrow, today], NOW);

	expect(home.today.map((e) => e.title)).toEqual(["Today"]);
});

test("today: events of several courses share the list and keep their course", () => {
	const a = event("Algebra class", new Date(2026, 2, 10, 10, 0), algebra);
	const b = event("Compilers lab", new Date(2026, 2, 10, 9, 0), compilers);

	const home = studentHome([], [a, b], NOW);

	expect(home.today).toEqual([b, a]);
});

//
// results
//

function attemptDone(): HomeExam["attempt"] {
	return { createdAt: at(-10 * DAY), acceptingSubmissions: false };
}

test("results: an EXAM released within the horizon is listed with its total and release moment", () => {
	const midterm = exam({
		title: "Midterm",
		status: "COMPLETED",
		gradesReleasedAt: at(-2 * DAY),
	});

	const home = studentHome(
		[homeExam(midterm, { attempt: attemptDone(), result: result(0.75) })],
		[],
		NOW,
	);

	expect(home.results).toEqual([
		{ course: algebra, exam: midterm, total: 0.75, releasedAt: at(-2 * DAY) },
	]);
});

test("results: a total still pending is passed on as null", () => {
	const midterm = exam({
		status: "COMPLETED",
		gradesReleasedAt: at(-DAY),
	});

	const home = studentHome(
		[homeExam(midterm, { attempt: attemptDone(), result: result(null) })],
		[],
		NOW,
	);

	expect(home.results).toHaveLength(1);
	expect(home.results[0]?.total).toBeNull();
});

test("results: the window is [now - horizon, now], both ends included", () => {
	const build = (title: string, releasedAt: Date) =>
		homeExam(
			exam({ title, status: "COMPLETED", gradesReleasedAt: releasedAt }),
			{
				attempt: attemptDone(),
				result: result(1),
			},
		);

	const home = studentHome(
		[
			build("Oldest edge", at(-HOME_HORIZON_MS)),
			build("Too old", at(-HOME_HORIZON_MS - 1)),
			build("Just now", at(0)),
			build("Not yet", at(1)),
		],
		[],
		NOW,
	);

	expect(titlesOf(home.results)).toEqual(["Just now", "Oldest edge"]);
});

test("results: a QUIZ is released when its window ends", () => {
	// Scheduled 3 days ago and 24 hours long with the extra hour, so the window ended 2 days ago.
	const quiz = exam({
		title: "Quiz",
		type: "QUIZ",
		status: "SCHEDULED",
		scheduledAt: at(-3 * DAY),
		duration: { hours: 23 },
		extraTime: { hours: 1 },
	});

	const home = studentHome(
		[homeExam(quiz, { attempt: attemptDone(), result: result(0.5) })],
		[],
		NOW,
	);

	expect(home.results).toEqual([
		{ course: algebra, exam: quiz, total: 0.5, releasedAt: at(-2 * DAY) },
	]);
});

test("results: a QUIZ whose window ended long ago is not new", () => {
	const quiz = exam({
		type: "QUIZ",
		scheduledAt: at(-30 * DAY),
		duration: { hours: 1 },
	});

	const home = studentHome(
		[homeExam(quiz, { attempt: attemptDone(), result: result(1) })],
		[],
		NOW,
	);

	expect(home.results).toEqual([]);
});

test("results: PRACTICE exams never appear", () => {
	const drill = exam({
		type: "PRACTICE",
		status: "COMPLETED",
		gradesReleasedAt: at(-DAY),
	});

	const home = studentHome(
		[homeExam(drill, { attempt: attemptDone(), result: result(1) })],
		[],
		NOW,
	);

	expect(home.results).toEqual([]);
});

test("results: an exam without a result or without an attempt is not listed", () => {
	const noResult = exam({
		title: "No result",
		status: "COMPLETED",
		gradesReleasedAt: at(-DAY),
	});
	const noAttempt = exam({
		title: "No attempt",
		status: "COMPLETED",
		gradesReleasedAt: at(-DAY),
	});

	const home = studentHome(
		[
			homeExam(noResult, { attempt: attemptDone(), result: null }),
			homeExam(noAttempt, { attempt: null, result: result(1) }),
		],
		[],
		NOW,
	);

	expect(home.results).toEqual([]);
});

test("results: an EXAM with no release date is not listed", () => {
	const unreleased = exam({ status: "COMPLETED", gradesReleasedAt: null });

	const home = studentHome(
		[homeExam(unreleased, { attempt: attemptDone(), result: result(1) })],
		[],
		NOW,
	);

	expect(home.results).toEqual([]);
});

test("results: newest release first", () => {
	const build = (title: string, releasedAt: Date) =>
		homeExam(
			exam({ title, status: "COMPLETED", gradesReleasedAt: releasedAt }),
			{
				attempt: attemptDone(),
				result: result(1),
			},
		);

	const home = studentHome(
		[
			build("Middle", at(-3 * DAY)),
			build("Newest", at(-1 * DAY)),
			build("Oldest", at(-6 * DAY)),
		],
		[],
		NOW,
	);

	expect(titlesOf(home.results)).toEqual(["Newest", "Middle", "Oldest"]);
});

//
// next
//

test("next: is null while any section has something in it", () => {
	const farEvent = event("Far away", new Date(2026, 3, 20, 10, 0));
	const withOpen = studentHome([homeExam(openExam())], [farEvent], NOW);
	const withUpcoming = studentHome(
		[homeExam(exam({ scheduledAt: at(DAY) }))],
		[farEvent],
		NOW,
	);
	const withToday = studentHome(
		[],
		[farEvent, event("Today", new Date(2026, 2, 10, 18, 0))],
		NOW,
	);
	const withResults = studentHome(
		[
			homeExam(exam({ status: "COMPLETED", gradesReleasedAt: at(-DAY) }), {
				attempt: attemptDone(),
				result: result(1),
			}),
		],
		[farEvent],
		NOW,
	);

	expect(withOpen.next).toBeNull();
	expect(withUpcoming.next).toBeNull();
	expect(withToday.next).toBeNull();
	expect(withResults.next).toBeNull();
});

test("next: on a quiet week it is the earliest event ahead, however far", () => {
	const later = event("Later", new Date(2026, 3, 20, 10, 0), compilers);
	const sooner = event("Sooner", new Date(2026, 2, 12, 10, 0), algebra);

	const home = studentHome([], [later, sooner], NOW);

	expect(home.next).toEqual({
		kind: "event",
		course: algebra,
		event: sooner,
		at: sooner.startAt,
	});
});

test("next: an exam beyond the horizon can be the next item", () => {
	const distant = exam({ title: "Distant", scheduledAt: at(20 * DAY) });
	const event30 = event("Far event", at(30 * DAY));

	const home = studentHome(
		[homeExam(distant, { course: compilers })],
		[event30],
		NOW,
	);

	expect(home.upcoming).toEqual([]);
	expect(home.next).toEqual({
		kind: "exam",
		course: compilers,
		exam: distant,
		at: distant.scheduledAt,
	});
});

test("next: an event beats a later exam", () => {
	const distant = exam({ scheduledAt: at(20 * DAY) });
	const sooner = event("Sooner", at(10 * DAY));

	const home = studentHome([homeExam(distant)], [sooner], NOW);

	expect(home.next).toMatchObject({ kind: "event", at: sooner.startAt });
});

test("next: ignores past events, undated exams, PRACTICE and drafts", () => {
	const past = event("Past", new Date(2026, 2, 9, 10, 0));
	const undated = exam({ title: "Undated" });
	const drill = exam({
		type: "PRACTICE",
		scheduledAt: at(15 * DAY),
	});
	const draft = exam({ status: "DRAFT", scheduledAt: at(16 * DAY) });
	const real = exam({ title: "Real", scheduledAt: at(40 * DAY) });

	const home = studentHome(
		[homeExam(undated), homeExam(drill), homeExam(draft), homeExam(real)],
		[past],
		NOW,
	);

	expect(home.next).toMatchObject({ kind: "exam", at: real.scheduledAt });
});

test("next: is null when nothing lies ahead", () => {
	const past = event("Past", new Date(2026, 2, 1, 10, 0));
	const missed = exam({
		scheduledAt: at(-5 * DAY),
		duration: { hours: 1 },
	});

	const home = studentHome([homeExam(missed)], [past], NOW);

	expect(home.next).toBeNull();
});
