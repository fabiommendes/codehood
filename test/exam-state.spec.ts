import { expect, test } from "@playwright/test";
import fc from "fast-check";
import type { AttemptTiming, ExamPhase, ExamTiming } from "@/db";
import {
	attemptDeadline,
	attemptState,
	examPhase,
	examPhaseLabels,
} from "@/db";

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
