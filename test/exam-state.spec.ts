import { expect, test } from "@playwright/test";
import fc from "fast-check";
import type { ExamResult, QuestionOutcomeStatus } from "@/services/exam-result";
import {
	type AttemptTiming,
	attemptDeadline,
	attemptState,
	type ExamPhase,
	type ExamTiming,
	type ExceptionTiming,
	examPhase,
	examPhaseLabels,
	gradeReleaseBlocker,
	lastWindowEnd,
	personalTiming,
	releaseMoment,
	resultsReleased,
	windowEnd,
} from "@/services/exam-state";

const MINUTE = 60_000;

/// Start of the scheduled window used across the cases.
const START = new Date("2026-03-10T10:00:00Z");

/// `START` shifted by `minutes`.
function at(minutes: number): Date {
	return new Date(START.getTime() + minutes * MINUTE);
}

/// A scheduled, timed exam: 90 minutes plus 30 of extra time, so the window is [10:00, 12:00).
function timed(overrides: Partial<ExamTiming> = {}): ExamTiming {
	return {
		type: "EXAM",
		status: "SCHEDULED",
		scheduledAt: START,
		duration: { hours: 1, minutes: 30 },
		extraTime: { minutes: 30 },
		...overrides,
	};
}

function untimed(overrides: Partial<ExamTiming> = {}): ExamTiming {
	return timed({ duration: null, extraTime: null, ...overrides });
}

function attempt(overrides: Partial<AttemptTiming> = {}): AttemptTiming {
	return {
		createdAt: at(15),
		acceptingSubmissions: true,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// examPhase: stored status that decides alone
// ---------------------------------------------------------------------------

const timeline: Array<[string, Date]> = [
	["long before the window", at(-10_000)],
	["inside the window", at(30)],
	["long after the window", at(10_000)],
];

for (const [when, now] of timeline) {
	test(`examPhase: DRAFT is draft ${when}`, () => {
		expect(examPhase(timed({ status: "DRAFT" }), now)).toBe("draft");
	});

	test(`examPhase: ARCHIVED is archived ${when}`, () => {
		expect(examPhase(timed({ status: "ARCHIVED" }), now)).toBe("archived");
	});

	test(`examPhase: COMPLETED is closed ${when}`, () => {
		expect(examPhase(timed({ status: "COMPLETED" }), now)).toBe("closed");
	});

	test(`examPhase: a SCHEDULED PRACTICE exam is open ${when}`, () => {
		expect(examPhase(timed({ type: "PRACTICE" }), now)).toBe("open");
	});

	test(`examPhase: an ONGOING PRACTICE exam is open ${when}`, () => {
		expect(examPhase(timed({ type: "PRACTICE", status: "ONGOING" }), now)).toBe(
			"open",
		);
	});
}

test("examPhase: a DRAFT or ARCHIVED PRACTICE exam keeps its stored phase", () => {
	expect(examPhase(timed({ type: "PRACTICE", status: "DRAFT" }), at(30))).toBe(
		"draft",
	);
	expect(
		examPhase(timed({ type: "PRACTICE", status: "ARCHIVED" }), at(30)),
	).toBe("archived");
});

test("examPhase: a COMPLETED PRACTICE exam is closed", () => {
	expect(
		examPhase(timed({ type: "PRACTICE", status: "COMPLETED" }), at(30)),
	).toBe("closed");
});

// ---------------------------------------------------------------------------
// examPhase: ONGOING
// ---------------------------------------------------------------------------

test("examPhase: ONGOING without a date or duration is open", () => {
	const exam = untimed({ status: "ONGOING", scheduledAt: null });
	expect(examPhase(exam, at(-10_000))).toBe("open");
	expect(examPhase(exam, at(10_000))).toBe("open");
});

test("examPhase: ONGOING with a date but no duration stays open forever", () => {
	expect(examPhase(untimed({ status: "ONGOING" }), at(10_000))).toBe("open");
});

test("examPhase: ONGOING with a duration but no date stays open forever", () => {
	const exam = timed({ status: "ONGOING", scheduledAt: null });
	expect(examPhase(exam, at(10_000))).toBe("open");
});

test("examPhase: ONGOING with date and duration is open before the date", () => {
	expect(examPhase(timed({ status: "ONGOING" }), at(-60))).toBe("open");
});

test("examPhase: ONGOING with date and duration is open inside the window", () => {
	expect(examPhase(timed({ status: "ONGOING" }), at(60))).toBe("open");
});

test("examPhase: ONGOING with date and duration is open one ms before the window ends", () => {
	const now = new Date(at(120).getTime() - 1);
	expect(examPhase(timed({ status: "ONGOING" }), now)).toBe("open");
});

test("examPhase: ONGOING with date and duration is closed after the window", () => {
	const now = new Date(at(120).getTime() + 1);
	expect(examPhase(timed({ status: "ONGOING" }), now)).toBe("closed");
});

test("examPhase: ONGOING window includes extra time", () => {
	const exam = timed({ status: "ONGOING", extraTime: { minutes: 60 } });
	expect(examPhase(exam, at(140))).toBe("open");
	expect(examPhase(exam, at(151))).toBe("closed");
});

// ---------------------------------------------------------------------------
// examPhase: SCHEDULED
// ---------------------------------------------------------------------------

test("examPhase: SCHEDULED without a date is upcoming", () => {
	const exam = timed({ scheduledAt: null });
	expect(examPhase(exam, at(-10_000))).toBe("upcoming");
	expect(examPhase(exam, at(10_000))).toBe("upcoming");
});

test("examPhase: SCHEDULED is upcoming before its date", () => {
	expect(examPhase(timed(), new Date(START.getTime() - 1))).toBe("upcoming");
});

test("examPhase: SCHEDULED is open exactly at its date", () => {
	expect(examPhase(timed(), START)).toBe("open");
});

test("examPhase: SCHEDULED is open inside its window", () => {
	expect(examPhase(timed(), at(60))).toBe("open");
});

test("examPhase: SCHEDULED is open one ms before duration plus extra time elapses", () => {
	expect(examPhase(timed(), new Date(at(120).getTime() - 1))).toBe("open");
});

test("examPhase: SCHEDULED is closed after duration plus extra time", () => {
	expect(examPhase(timed(), new Date(at(120).getTime() + 1))).toBe("closed");
	expect(examPhase(timed(), at(10_000))).toBe("closed");
});

test("examPhase: extra time extends the window, and null extra time adds nothing", () => {
	// 90 minutes of duration alone: closed at 11:31, open at 11:29.
	const noExtra = timed({ extraTime: null });
	expect(examPhase(noExtra, at(89))).toBe("open");
	expect(examPhase(noExtra, at(91))).toBe("closed");

	// The same instant is still open once 30 minutes of extra time apply.
	expect(examPhase(timed(), at(91))).toBe("open");
});

test("examPhase: duration given in hours only is honoured", () => {
	const exam = timed({ duration: { hours: 2 }, extraTime: null });
	expect(examPhase(exam, at(119))).toBe("open");
	expect(examPhase(exam, at(121))).toBe("closed");
});

test("examPhase: untimed SCHEDULED is open from its date on, and never closes", () => {
	const exam = untimed();
	expect(examPhase(exam, new Date(START.getTime() - 1))).toBe("upcoming");
	expect(examPhase(exam, START)).toBe("open");
	expect(examPhase(exam, at(100_000))).toBe("open");
});

test("examPhase: SCHEDULED timeline is upcoming, then open, then closed (property)", () => {
	fc.assert(
		fc.property(
			fc.integer({ min: 1, max: 600 }),
			fc.integer({ min: 0, max: 120 }),
			fc.integer({ min: -2000, max: 2000 }),
			(durationMinutes, extraMinutes, offset) => {
				const total = durationMinutes + extraMinutes;
				fc.pre(offset !== total);
				const exam = timed({
					duration: { minutes: durationMinutes },
					extraTime: { minutes: extraMinutes },
				});
				const expected: ExamPhase =
					offset < 0 ? "upcoming" : offset < total ? "open" : "closed";
				expect(examPhase(exam, at(offset))).toBe(expected);
			},
		),
	);
});

// ---------------------------------------------------------------------------
// examPhaseLabels
// ---------------------------------------------------------------------------

test("examPhaseLabels: human text for every phase", () => {
	expect(examPhaseLabels).toEqual({
		draft: "Draft",
		upcoming: "Upcoming",
		open: "Open now",
		closed: "Closed",
		archived: "Archived",
	});
});

// ---------------------------------------------------------------------------
// attemptDeadline
// ---------------------------------------------------------------------------

test("attemptDeadline: scheduled and timed ends at scheduledAt + duration + extraTime", () => {
	expect(attemptDeadline(timed(), attempt())).toEqual(at(120));
});

test("attemptDeadline: scheduled and timed is the same for every attempt", () => {
	const early = attemptDeadline(timed(), attempt({ createdAt: at(1) }));
	const late = attemptDeadline(timed(), attempt({ createdAt: at(100) }));
	expect(early).toEqual(at(120));
	expect(late).toEqual(at(120));
});

test("attemptDeadline: null extra time adds nothing", () => {
	expect(attemptDeadline(timed({ extraTime: null }), attempt())).toEqual(
		at(90),
	);
});

test("attemptDeadline: unscheduled and timed counts from attempt.createdAt", () => {
	const exam = timed({ status: "ONGOING", scheduledAt: null });
	expect(attemptDeadline(exam, attempt({ createdAt: at(15) }))).toEqual(
		at(135),
	);
	expect(attemptDeadline(exam, attempt({ createdAt: at(40) }))).toEqual(
		at(160),
	);
});

test("attemptDeadline: unscheduled and timed with null extra time is createdAt + duration", () => {
	const exam = timed({
		status: "ONGOING",
		scheduledAt: null,
		extraTime: null,
	});
	expect(attemptDeadline(exam, attempt({ createdAt: at(15) }))).toEqual(
		at(105),
	);
});

test("attemptDeadline: untimed exam has no deadline, scheduled or not", () => {
	expect(attemptDeadline(untimed(), attempt())).toBeNull();
	expect(
		attemptDeadline(
			untimed({ scheduledAt: null, status: "ONGOING" }),
			attempt(),
		),
	).toBeNull();
});

// ---------------------------------------------------------------------------
// attemptState
// ---------------------------------------------------------------------------

test("attemptState: upcoming exam is not-open with opensAt set to scheduledAt", () => {
	expect(attemptState(timed(), null, at(-30))).toEqual({
		kind: "not-open",
		opensAt: START,
	});
});

test("attemptState: SCHEDULED exam without a date is not-open with opensAt null", () => {
	expect(attemptState(timed({ scheduledAt: null }), null, at(30))).toEqual({
		kind: "not-open",
		opensAt: null,
	});
});

test("attemptState: draft and archived exams are not-open with opensAt null", () => {
	for (const status of ["DRAFT", "ARCHIVED"] as const) {
		expect(attemptState(timed({ status }), null, at(30))).toEqual({
			kind: "not-open",
			opensAt: null,
		});
	}
});

test("attemptState: open exam with no attempt can be started", () => {
	expect(attemptState(timed(), null, at(30))).toEqual({ kind: "can-start" });
});

test("attemptState: exactly at the start an open exam can be started", () => {
	expect(attemptState(timed(), null, START)).toEqual({ kind: "can-start" });
});

test("attemptState: a PRACTICE exam with no attempt can always be started", () => {
	expect(attemptState(timed({ type: "PRACTICE" }), null, at(10_000))).toEqual({
		kind: "can-start",
	});
});

test("attemptState: an attempt accepting submissions before the deadline is in-progress", () => {
	expect(attemptState(timed(), attempt(), at(60))).toEqual({
		kind: "in-progress",
		deadline: at(120),
	});
});

test("attemptState: in-progress on an untimed exam has a null deadline", () => {
	expect(attemptState(untimed(), attempt(), at(60))).toEqual({
		kind: "in-progress",
		deadline: null,
	});
});

test("attemptState: in-progress on an unscheduled timed exam counts from createdAt", () => {
	const exam = timed({ status: "ONGOING", scheduledAt: null });
	expect(attemptState(exam, attempt({ createdAt: at(15) }), at(60))).toEqual({
		kind: "in-progress",
		deadline: at(135),
	});
});

test("attemptState: an attempt that stopped accepting submissions is submitted", () => {
	const finished = attempt({ acceptingSubmissions: false });
	expect(attemptState(timed(), finished, at(60))).toEqual({
		kind: "submitted",
	});
});

test("attemptState: an attempt past its own deadline on an open exam is submitted", () => {
	// The exam is open (no date), but this attempt started 2h ago with a 90+30 minute limit.
	const exam = timed({ status: "ONGOING", scheduledAt: null });
	const stale = attempt({ createdAt: at(0) });
	expect(attemptState(exam, stale, at(121))).toEqual({ kind: "submitted" });
});

test("attemptState: closed exam with no attempt is missed", () => {
	expect(attemptState(timed(), null, at(121))).toEqual({ kind: "missed" });
});

test("attemptState: COMPLETED exam with no attempt is missed", () => {
	expect(attemptState(timed({ status: "COMPLETED" }), null, at(30))).toEqual({
		kind: "missed",
	});
});

test("attemptState: closed exam with an attempt is submitted, even one still accepting", () => {
	expect(attemptState(timed(), attempt(), at(121))).toEqual({
		kind: "submitted",
	});
	expect(
		attemptState(
			timed({ status: "COMPLETED" }),
			attempt({ acceptingSubmissions: true }),
			at(30),
		),
	).toEqual({ kind: "submitted" });
});

// ---------------------------------------------------------------------------
// resultsReleased
// ---------------------------------------------------------------------------

test("resultsReleased: a PRACTICE exam is always released", () => {
	for (const status of [
		"DRAFT",
		"SCHEDULED",
		"ONGOING",
		"COMPLETED",
	] as const) {
		for (const [, now] of timeline) {
			expect(resultsReleased(timed({ type: "PRACTICE", status }), now)).toBe(
				true,
			);
		}
	}
});

test("resultsReleased: a QUIZ is released once its phase is closed", () => {
	const quiz = timed({ type: "QUIZ" });
	expect(resultsReleased(quiz, new Date(at(120).getTime() + 1))).toBe(true);
	expect(resultsReleased(quiz, at(10_000))).toBe(true);
	expect(
		resultsReleased(timed({ type: "QUIZ", status: "COMPLETED" }), at(30)),
	).toBe(true);
});

test("resultsReleased: a QUIZ is not released before its phase is closed", () => {
	const quiz = timed({ type: "QUIZ" });
	expect(resultsReleased(quiz, at(-60))).toBe(false);
	expect(resultsReleased(quiz, START)).toBe(false);
	expect(resultsReleased(quiz, new Date(at(120).getTime() - 1))).toBe(false);
});

test("resultsReleased: an EXAM is released from the moment gradesReleasedAt is reached", () => {
	const exam = timed({ gradesReleasedAt: at(300) });
	expect(resultsReleased(exam, new Date(at(300).getTime() - 1))).toBe(false);
	expect(resultsReleased(exam, at(300))).toBe(true);
	expect(resultsReleased(exam, at(10_000))).toBe(true);
});

test("resultsReleased: an EXAM without gradesReleasedAt is never released, even when closed", () => {
	expect(resultsReleased(timed({ gradesReleasedAt: null }), at(10_000))).toBe(
		false,
	);
	expect(resultsReleased(timed(), at(10_000))).toBe(false);
	expect(
		resultsReleased(
			timed({ status: "COMPLETED", gradesReleasedAt: null }),
			at(10_000),
		),
	).toBe(false);
});

// ---------------------------------------------------------------------------
// attemptState: results
// ---------------------------------------------------------------------------

test("attemptState: a submitted attempt is results once grades are released", () => {
	const exam = timed({ gradesReleasedAt: at(130) });
	const finished = attempt({ acceptingSubmissions: false });

	expect(attemptState(exam, finished, at(60))).toEqual({ kind: "submitted" });
	expect(attemptState(exam, finished, at(130))).toEqual({ kind: "results" });
});

test("attemptState: a submitted attempt stays submitted while grades are not released", () => {
	const finished = attempt({ acceptingSubmissions: false });

	expect(attemptState(timed(), finished, at(10_000))).toEqual({
		kind: "submitted",
	});
	expect(
		attemptState(timed({ gradesReleasedAt: at(500) }), finished, at(200)),
	).toEqual({ kind: "submitted" });
});

test("attemptState: an attempt on a closed QUIZ is results", () => {
	expect(attemptState(timed({ type: "QUIZ" }), attempt(), at(121))).toEqual({
		kind: "results",
	});
});

test("attemptState: an attempt past its own deadline is results once released", () => {
	const exam = timed({
		status: "ONGOING",
		scheduledAt: null,
		gradesReleasedAt: at(0),
	});

	expect(attemptState(exam, attempt({ createdAt: at(0) }), at(121))).toEqual({
		kind: "results",
	});
});

test("attemptState: a finished PRACTICE attempt is results", () => {
	const finished = attempt({ acceptingSubmissions: false });

	expect(attemptState(timed({ type: "PRACTICE" }), finished, at(60))).toEqual({
		kind: "results",
	});
});

test("attemptState: in-progress, can-start, not-open and missed are unaffected by released grades", () => {
	const released = { gradesReleasedAt: at(-1000) };

	expect(attemptState(timed(released), attempt(), at(60))).toEqual({
		kind: "in-progress",
		deadline: at(120),
	});
	expect(attemptState(timed(released), null, at(60))).toEqual({
		kind: "can-start",
	});
	expect(attemptState(timed(released), null, at(-30))).toEqual({
		kind: "not-open",
		opensAt: START,
	});
	expect(attemptState(timed(released), null, at(121))).toEqual({
		kind: "missed",
	});
});

test("attemptState: a missed QUIZ stays missed although its grades are released", () => {
	expect(attemptState(timed({ type: "QUIZ" }), null, at(121))).toEqual({
		kind: "missed",
	});
});

test("attemptState: an open PRACTICE exam keeps an attempt in progress and lets a student start", () => {
	const practice = timed({ type: "PRACTICE" });

	expect(attemptState(practice, null, at(60))).toEqual({ kind: "can-start" });
	expect(attemptState(practice, attempt(), at(60))).toEqual({
		kind: "in-progress",
		deadline: at(120),
	});
});

// ---------------------------------------------------------------------------
// releaseMoment
// ---------------------------------------------------------------------------

test("releaseMoment: a timed QUIZ releases at its window end, and not before", () => {
	const quiz = timed({ type: "QUIZ" });
	expect(releaseMoment(quiz, at(60))).toBeNull();
	expect(releaseMoment(quiz, at(10_000))).toEqual(at(120));
});

test("releaseMoment: a QUIZ completed before or without a window end has no known moment", () => {
	expect(
		releaseMoment(timed({ type: "QUIZ", status: "COMPLETED" }), at(30)),
	).toBeNull();
	expect(
		releaseMoment(untimed({ type: "QUIZ", status: "COMPLETED" }), at(30)),
	).toBeNull();
});

test("releaseMoment: an untimed QUIZ still open is not released", () => {
	const quiz = untimed({ type: "QUIZ" });
	expect(resultsReleased(quiz, at(10_000))).toBe(false);
	expect(releaseMoment(quiz, at(10_000))).toBeNull();
});

test("releaseMoment: an EXAM releases at gradesReleasedAt once reached", () => {
	const exam = timed({ gradesReleasedAt: at(300) });
	expect(releaseMoment(exam, at(200))).toBeNull();
	expect(releaseMoment(exam, at(400))).toEqual(at(300));
});

test("releaseMoment: a PRACTICE exam is released with no known moment", () => {
	expect(releaseMoment(timed({ type: "PRACTICE" }), at(30))).toBeNull();
});

test("releaseMoment: whenever it returns a moment, resultsReleased holds and the moment is not after now", () => {
	fc.assert(
		fc.property(
			fc.constantFrom("PRACTICE", "QUIZ", "EXAM"),
			fc.constantFrom("SCHEDULED", "ONGOING", "COMPLETED"),
			fc.option(fc.integer({ min: -500, max: 500 })),
			fc.option(fc.integer({ min: 1, max: 300 })),
			fc.option(fc.integer({ min: -500, max: 500 })),
			fc.integer({ min: -1000, max: 1000 }),
			(type, status, start, minutes, released, when) => {
				const exam = timed({
					type,
					status,
					scheduledAt: start === null ? null : at(start),
					duration: minutes === null ? null : { minutes },
					extraTime: null,
					gradesReleasedAt: released === null ? null : at(released),
				});
				const now = at(when);
				const moment = releaseMoment(exam, now);
				if (moment === null) return;
				expect(resultsReleased(exam, now)).toBe(true);
				expect(moment.getTime()).toBeLessThanOrEqual(now.getTime());
			},
		),
	);
});

// ---------------------------------------------------------------------------
// gradeReleaseBlocker
// ---------------------------------------------------------------------------

/// A result whose questions have the given statuses.
function result(...statuses: QuestionOutcomeStatus[]): ExamResult {
	return {
		questions: statuses.map((status, i) => ({
			question: `q${i}`,
			status,
			score: status === "graded" ? 1 : null,
			comments: [],
		})),
		total: null,
	};
}

test("gradeReleaseBlocker: a closed, unreleased EXAM with every answer graded can be released", () => {
	const exam = timed({ status: "COMPLETED" });
	expect(
		gradeReleaseBlocker(exam, [result("graded", "unanswered")], at(30)),
	).toBeNull();
});

test("gradeReleaseBlocker: an EXAM nobody attempted can be released", () => {
	expect(gradeReleaseBlocker(timed(), [], at(10_000))).toBeNull();
});

test("gradeReleaseBlocker: only an EXAM is released by hand", () => {
	for (const type of ["PRACTICE", "QUIZ"] as const) {
		expect(
			gradeReleaseBlocker(timed({ type, status: "COMPLETED" }), [], at(30)),
		).toBe("not-an-exam");
	}
});

test("gradeReleaseBlocker: an EXAM not closed yet cannot be released", () => {
	expect(gradeReleaseBlocker(timed(), [], at(-60))).toBe("not-closed");
	expect(gradeReleaseBlocker(timed(), [], at(30))).toBe("not-closed");
	expect(gradeReleaseBlocker(untimed(), [], at(10_000))).toBe("not-closed");
});

test("gradeReleaseBlocker: an EXAM already released reports released", () => {
	expect(
		gradeReleaseBlocker(timed({ gradesReleasedAt: at(200) }), [], at(300)),
	).toBe("released");
});

test("gradeReleaseBlocker: one answer waiting for a grade blocks the release", () => {
	expect(
		gradeReleaseBlocker(
			timed(),
			[result("graded"), result("graded", "pending")],
			at(10_000),
		),
	).toBe("pending");
});

// ---------------------------------------------------------------------------
// personalTiming: extra time
// ---------------------------------------------------------------------------

/// An exception granting `minutes` of extra time and no new date.
function extra(minutes: number): ExceptionTiming {
	return { extraTime: { minutes }, scheduledAt: null };
}

test("personalTiming: the student's extra time adds to the exam's own", () => {
	// Window of timed(): 90 + 30 minutes. With 45 more it ends at 10:00 + 165.
	const own = personalTiming(timed(), extra(45));
	expect(windowEnd(own)).toEqual(at(165));
});

test("personalTiming: extra time adds to an exam that has none of its own", () => {
	const own = personalTiming(timed({ extraTime: null }), extra(45));
	expect(windowEnd(own)).toEqual(at(135));
});

test("personalTiming: extra time moves the deadline of a scheduled exam", () => {
	const own = personalTiming(timed(), extra(45));
	expect(attemptDeadline(own, attempt())).toEqual(at(165));
	expect(attemptDeadline(timed(), attempt())).toEqual(at(120));
});

test("personalTiming: extra time moves the deadline counted from the attempt start", () => {
	const unscheduled = timed({ status: "ONGOING", scheduledAt: null });
	const own = personalTiming(unscheduled, extra(45));
	// Attempt started at 10:15; 90 + 30 + 45 minutes later.
	expect(attemptDeadline(own, attempt({ createdAt: at(15) }))).toEqual(
		at(15 + 165),
	);
});

test("personalTiming: the student with extra time is still in progress after the general deadline", () => {
	const own = personalTiming(timed(), extra(45));
	expect(attemptState(own, attempt(), at(150))).toEqual({
		kind: "in-progress",
		deadline: at(165),
	});
});

test("personalTiming: without an exception the exam comes back unchanged", () => {
	const exam = timed();
	expect(personalTiming(exam, null)).toEqual(exam);
});

test("personalTiming: leaves the exam it was given untouched", () => {
	const exam = timed();
	personalTiming(exam, extra(45));
	expect(exam).toEqual(timed());
});

test("personalTiming: a PRACTICE exam ignores the exception", () => {
	const practice = timed({ type: "PRACTICE" });
	expect(personalTiming(practice, extra(45))).toEqual(practice);
});

// ---------------------------------------------------------------------------
// personalTiming: makeup date
// ---------------------------------------------------------------------------

/// A makeup starting `minutes` after `START`, with no extra time.
function makeup(minutes: number): ExceptionTiming {
	return { extraTime: null, scheduledAt: at(minutes) };
}

test("personalTiming: a makeup on a COMPLETED exam is upcoming, then open, then closed", () => {
	// Makeup window: [START + 2000, START + 2120), the exam's own 90 + 30 minutes.
	const personal = personalTiming(timed({ status: "COMPLETED" }), makeup(2000));
	expect(examPhase(personal, at(1999))).toBe("upcoming");
	expect(examPhase(personal, at(2000))).toBe("open");
	expect(examPhase(personal, at(2120))).toBe("open");
	expect(examPhase(personal, at(2121))).toBe("closed");
});

test("personalTiming: a makeup leaves the COMPLETED exam closed for everyone else", () => {
	const base = timed({ status: "COMPLETED" });
	personalTiming(base, makeup(2000));
	expect(examPhase(base, at(2060))).toBe("closed");
});

test("personalTiming: a makeup reopens an ONGOING exam whose window passed", () => {
	const personal = personalTiming(timed({ status: "ONGOING" }), makeup(2000));
	expect(examPhase(personal, at(1000))).toBe("upcoming");
	expect(examPhase(personal, at(2060))).toBe("open");
});

test("personalTiming: a makeup keeps the exam's own extra time and adds the student's", () => {
	const personal = personalTiming(timed({ status: "COMPLETED" }), {
		extraTime: { minutes: 45 },
		scheduledAt: at(2000),
	});
	expect(windowEnd(personal)).toEqual(at(2000 + 165));
});

test("personalTiming: the makeup opens the state of a student who missed the exam", () => {
	const personal = personalTiming(timed({ status: "COMPLETED" }), makeup(2000));
	expect(attemptState(personal, null, at(1000))).toEqual({
		kind: "not-open",
		opensAt: at(2000),
	});
	expect(attemptState(personal, null, at(2060))).toEqual({ kind: "can-start" });
});

test("personalTiming: extra time alone does not reopen a COMPLETED exam", () => {
	const personal = personalTiming(timed({ status: "COMPLETED" }), extra(45));
	expect(examPhase(personal, at(30))).toBe("closed");
});

for (const status of ["DRAFT", "ARCHIVED"] as const) {
	test(`personalTiming: a makeup does not change a ${status} exam`, () => {
		const personal = personalTiming(timed({ status }), makeup(2000));
		expect(personal.status).toBe(status);
		expect(examPhase(personal, at(2060))).toBe(status.toLowerCase());
	});
}

// ---------------------------------------------------------------------------
// lastWindowEnd
// ---------------------------------------------------------------------------

test("lastWindowEnd: without exceptions it is the end of the exam's window", () => {
	expect(lastWindowEnd(timed(), [])).toEqual(at(120));
});

test("lastWindowEnd: a makeup after the exam is the latest end", () => {
	expect(lastWindowEnd(timed(), [makeup(2000)])).toEqual(at(2120));
});

test("lastWindowEnd: extra time pushes the end past the exam's own", () => {
	expect(lastWindowEnd(timed(), [extra(45)])).toEqual(at(165));
});

test("lastWindowEnd: picks the latest among several personal windows", () => {
	const exceptions = [extra(45), makeup(500), makeup(300), extra(10)];
	expect(lastWindowEnd(timed(), exceptions)).toEqual(at(620));
});

test("lastWindowEnd: a makeup before the exam does not pull the end back", () => {
	expect(lastWindowEnd(timed(), [makeup(-1000)])).toEqual(at(120));
});

test("lastWindowEnd: an exam without duration has no end, exceptions or not", () => {
	expect(lastWindowEnd(untimed(), [])).toBeNull();
	expect(lastWindowEnd(untimed(), [extra(45)])).toBeNull();
});

test("lastWindowEnd: an exam without a date has no end even with a makeup on it", () => {
	const unscheduled = timed({ status: "ONGOING", scheduledAt: null });
	expect(lastWindowEnd(unscheduled, [makeup(2000)])).toBeNull();
});

// ---------------------------------------------------------------------------
// Releasing grades with exceptions pending
// ---------------------------------------------------------------------------

/// One millisecond after `date`, the first instant its window is over.
function justAfter(date: Date): Date {
	return new Date(date.getTime() + 1);
}

/// A window [START, START + 120) closed by hand or by the clock, with grades to release.
const closedExam = () => timed({ status: "COMPLETED" });

test("gradeReleaseBlocker: a student's extra time still running blocks the release", () => {
	// The exam's window ended at +120; the student's runs until +165.
	expect(gradeReleaseBlocker(timed(), [], at(130), [extra(45)])).toBe(
		"exception-open",
	);
});

test("gradeReleaseBlocker: the release is blocked through the last instant of the personal window", () => {
	expect(gradeReleaseBlocker(timed(), [], at(165), [extra(45)])).toBe(
		"exception-open",
	);
	expect(
		gradeReleaseBlocker(timed(), [], justAfter(at(165)), [extra(45)]),
	).toBe(null);
});

test("gradeReleaseBlocker: a makeup not yet started blocks the release", () => {
	expect(gradeReleaseBlocker(closedExam(), [], at(130), [makeup(2000)])).toBe(
		"exception-open",
	);
});

test("gradeReleaseBlocker: a makeup in progress blocks the release", () => {
	expect(gradeReleaseBlocker(closedExam(), [], at(2060), [makeup(2000)])).toBe(
		"exception-open",
	);
});

test("gradeReleaseBlocker: a makeup that is over no longer blocks the release", () => {
	expect(
		gradeReleaseBlocker(closedExam(), [], justAfter(at(2120)), [makeup(2000)]),
	).toBe(null);
});

test("gradeReleaseBlocker: one open window among closed ones blocks the release", () => {
	const exceptions = [makeup(200), extra(10), makeup(2000)];
	expect(gradeReleaseBlocker(closedExam(), [], at(2060), exceptions)).toBe(
		"exception-open",
	);
});

test("gradeReleaseBlocker: extra time alone does not reopen an exam completed by hand", () => {
	expect(gradeReleaseBlocker(closedExam(), [], at(130), [extra(45)])).toBe(
		null,
	);
});

test("gradeReleaseBlocker: not-closed comes before exception-open", () => {
	expect(gradeReleaseBlocker(timed(), [], at(30), [extra(45)])).toBe(
		"not-closed",
	);
});

test("gradeReleaseBlocker: released comes before exception-open", () => {
	const exam = closedExam();
	exam.gradesReleasedAt = at(130);
	expect(gradeReleaseBlocker(exam, [], at(200), [makeup(2000)])).toBe(
		"released",
	);
});

test("gradeReleaseBlocker: exception-open comes before pending", () => {
	expect(
		gradeReleaseBlocker(closedExam(), [result("pending")], at(130), [
			makeup(2000),
		]),
	).toBe("exception-open");
});

test("gradeReleaseBlocker: pending is reported once every personal window is over", () => {
	expect(
		gradeReleaseBlocker(
			closedExam(),
			[result("pending")],
			justAfter(at(2120)),
			[makeup(2000)],
		),
	).toBe("pending");
});

// ---------------------------------------------------------------------------
// QUIZ results with exceptions pending
// ---------------------------------------------------------------------------

const quiz = (overrides: Partial<ExamTiming> = {}) =>
	timed({ type: "QUIZ", ...overrides });

test("resultsReleased: a QUIZ is held back while a student's extra time runs", () => {
	expect(resultsReleased(quiz(), at(130), [extra(45)])).toBe(false);
	expect(resultsReleased(quiz(), at(165), [extra(45)])).toBe(false);
});

test("resultsReleased: a QUIZ is released right after the last personal window ends", () => {
	expect(resultsReleased(quiz(), justAfter(at(165)), [extra(45)])).toBe(true);
});

test("resultsReleased: a QUIZ waits for a makeup that has not started", () => {
	expect(resultsReleased(quiz(), at(130), [makeup(2000)])).toBe(false);
});

test("resultsReleased: a QUIZ waits for a makeup in progress, then releases", () => {
	expect(resultsReleased(quiz(), at(2060), [makeup(2000)])).toBe(false);
	expect(resultsReleased(quiz(), justAfter(at(2120)), [makeup(2000)])).toBe(
		true,
	);
});

test("resultsReleased: a QUIZ completed by hand still waits for a makeup", () => {
	expect(
		resultsReleased(quiz({ status: "COMPLETED" }), at(130), [makeup(2000)]),
	).toBe(false);
});

test("resultsReleased: a QUIZ completed by hand ignores extra time alone", () => {
	expect(
		resultsReleased(quiz({ status: "COMPLETED" }), at(130), [extra(45)]),
	).toBe(true);
});

test("resultsReleased: a QUIZ whose window is still open stays unreleased whatever the exceptions", () => {
	expect(resultsReleased(quiz(), at(30), [extra(45)])).toBe(false);
});

test("resultsReleased: exceptions do not hold back an EXAM whose grades were released", () => {
	const released = timed({ gradesReleasedAt: at(130) });
	expect(resultsReleased(released, at(200), [makeup(2000)])).toBe(true);
});

test("resultsReleased: exceptions do not hold back a PRACTICE exam", () => {
	expect(
		resultsReleased(timed({ type: "PRACTICE" }), at(30), [makeup(2000)]),
	).toBe(true);
});

test("releaseMoment: a QUIZ is released when the last personal window ends", () => {
	expect(releaseMoment(quiz(), at(200), [extra(45)])).toEqual(at(165));
	expect(releaseMoment(quiz(), at(2200), [makeup(2000), extra(10)])).toEqual(
		at(2120),
	);
});

test("releaseMoment: a QUIZ has no release moment while a personal window is pending", () => {
	expect(releaseMoment(quiz(), at(130), [extra(45)])).toBeNull();
	expect(releaseMoment(quiz(), at(130), [makeup(2000)])).toBeNull();
});

// ---------------------------------------------------------------------------
// attemptState with a pending makeup
// ---------------------------------------------------------------------------

test("attemptState: a closed QUIZ attempt stays submitted while another student's makeup is pending", () => {
	const exam = quiz();
	const now = at(130);
	const released = resultsReleased(exam, now, [makeup(2000)]);
	expect(attemptState(exam, attempt(), now, { released })).toEqual({
		kind: "submitted",
	});
});

test("attemptState: released replaces the exam's own release rule in both directions", () => {
	const exam = quiz();
	const now = at(130);
	expect(attemptState(exam, attempt(), now, { released: false })).toEqual({
		kind: "submitted",
	});
	expect(attemptState(exam, attempt(), now, { released: true })).toEqual({
		kind: "results",
	});
	const unreleased = timed({ gradesReleasedAt: null });
	expect(attemptState(unreleased, attempt(), now, { released: true })).toEqual({
		kind: "results",
	});
});

test("attemptState: the makeup student waits for their own window whatever released says", () => {
	const personal = personalTiming(quiz(), makeup(2000));
	expect(attemptState(personal, null, at(130), { released: false })).toEqual({
		kind: "not-open",
		opensAt: at(2000),
	});
});

test("attemptState: a missed attempt stays missed although released is true", () => {
	expect(attemptState(quiz(), null, at(130), { released: true })).toEqual({
		kind: "missed",
	});
});
