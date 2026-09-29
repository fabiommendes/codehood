import { expect, test } from "@playwright/test";
import type { Exam } from "@/db";
import { groupExamsForStudent } from "@/db";

let nextId = 1;

/// A moment before every scheduled date used by the older cases.
const NOW = new Date("2025-12-01T00:00:00Z");

/** A minimal, valid `Exam` literal — override only the fields a case cares about. */
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
		author: "instructor",
		rev: null,
		tags: [],
		questions: [],
		createdAt: new Date("2026-01-01T00:00:00Z"),
		updatedAt: new Date("2026-01-01T00:00:00Z"),
		...overrides,
	};
}

function titles(exams: Exam[]): string[] {
	return exams.map((e) => e.title);
}

function sectionOf(
	groups: ReturnType<typeof groupExamsForStudent>,
	key: string,
) {
	return groups.find((g) => g.key === key);
}

test("every non-draft, non-archived (status, type) pair lands in exactly one section", () => {
	const statuses: Exam["status"][] = ["SCHEDULED", "ONGOING", "COMPLETED"];
	const types: Exam["type"][] = ["PRACTICE", "QUIZ", "EXAM"];
	const expected: Record<
		string,
		{ status: Exam["status"]; type: Exam["type"] }[]
	> = {
		open: [],
		practice: [],
		upcoming: [],
		past: [],
	};

	for (const status of statuses) {
		for (const type of types) {
			if (status === "ONGOING" && type !== "PRACTICE") {
				expected.open?.push({ status, type });
			}
			if (type === "PRACTICE" && status !== "COMPLETED") {
				expected.practice?.push({ status, type });
			}
			if (status === "SCHEDULED" && type !== "PRACTICE") {
				expected.upcoming?.push({ status, type });
			}
			if (status === "COMPLETED") {
				expected.past?.push({ status, type });
			}
		}
	}

	const exams = statuses.flatMap((status) =>
		types.map((type) =>
			exam({
				status,
				type,
				title: `${status}-${type}`,
				scheduledAt: new Date("2026-03-01T00:00:00Z"),
			}),
		),
	);

	const groups = groupExamsForStudent(exams, NOW);

	for (const key of ["open", "practice", "upcoming", "past"] as const) {
		const want = expected[key] ?? [];
		const section = sectionOf(groups, key);
		if (want.length === 0) {
			expect(section).toBeUndefined();
			continue;
		}
		expect(section?.exams.map((e) => e.title).sort()).toEqual(
			want.map(({ status, type }) => `${status}-${type}`).sort(),
		);
	}

	// Every input exam landed in exactly one section.
	const totalPlaced = groups.reduce((n, g) => n + g.exams.length, 0);
	const expectedTotal = Object.values(expected).reduce(
		(n, l) => n + l.length,
		0,
	);
	expect(totalPlaced).toBe(expectedTotal);
});

test("DRAFT and ARCHIVED exams are dropped regardless of type", () => {
	const exams: Exam[] = [
		exam({ status: "DRAFT", type: "EXAM" }),
		exam({ status: "DRAFT", type: "PRACTICE" }),
		exam({ status: "ARCHIVED", type: "QUIZ" }),
		exam({ status: "ARCHIVED", type: "PRACTICE" }),
	];

	const groups = groupExamsForStudent(exams, NOW);
	expect(groups).toEqual([]);
});

test("labels are fixed and match the spec", () => {
	const exams: Exam[] = [
		exam({ status: "ONGOING", type: "EXAM", title: "Open one" }),
		exam({ status: "SCHEDULED", type: "PRACTICE", title: "Practice one" }),
		exam({ status: "SCHEDULED", type: "EXAM", title: "Upcoming one" }),
		exam({ status: "COMPLETED", type: "EXAM", title: "Past one" }),
	];

	const groups = groupExamsForStudent(exams, NOW);
	expect(sectionOf(groups, "open")?.label).toBe("Open");
	expect(sectionOf(groups, "practice")?.label).toBe("Practice");
	expect(sectionOf(groups, "upcoming")?.label).toBe("Upcoming");
	expect(sectionOf(groups, "past")?.label).toBe("Past exams and grades");
});

test("sections appear in fixed order — Open, Practice, Upcoming, Past — and only when non-empty", () => {
	const exams: Exam[] = [
		exam({ status: "COMPLETED", type: "EXAM" }),
		exam({ status: "SCHEDULED", type: "EXAM" }),
		exam({ status: "SCHEDULED", type: "PRACTICE" }),
		exam({ status: "ONGOING", type: "EXAM" }),
	];

	const groups = groupExamsForStudent(exams, NOW);
	expect(groups.map((g) => g.key)).toEqual([
		"open",
		"practice",
		"upcoming",
		"past",
	]);
});

test("Open section: ordered by scheduledAt ascending, unscheduled exams last", () => {
	const early = exam({
		status: "ONGOING",
		type: "EXAM",
		title: "Early",
		scheduledAt: new Date("2026-01-01T09:00:00Z"),
	});
	const late = exam({
		status: "ONGOING",
		type: "EXAM",
		title: "Late",
		scheduledAt: new Date("2026-02-01T09:00:00Z"),
	});
	const unscheduled = exam({
		status: "ONGOING",
		type: "EXAM",
		title: "Unscheduled",
		scheduledAt: null,
	});

	const groups = groupExamsForStudent([unscheduled, late, early], NOW);
	expect(titles(sectionOf(groups, "open")?.exams ?? [])).toEqual([
		"Early",
		"Late",
		"Unscheduled",
	]);
});

test("Open section excludes PRACTICE exams even when ONGOING", () => {
	const ongoingExam = exam({
		status: "ONGOING",
		type: "EXAM",
		title: "Real exam",
	});
	const ongoingPractice = exam({
		status: "ONGOING",
		type: "PRACTICE",
		title: "Ongoing practice",
	});

	const groups = groupExamsForStudent([ongoingExam, ongoingPractice], NOW);
	expect(titles(sectionOf(groups, "open")?.exams ?? [])).toEqual(["Real exam"]);
	expect(titles(sectionOf(groups, "practice")?.exams ?? [])).toEqual([
		"Ongoing practice",
	]);
});

test("Practice section: ordered by title ascending, COMPLETED practice exams excluded", () => {
	const zebra = exam({
		status: "SCHEDULED",
		type: "PRACTICE",
		title: "Zebra drill",
	});
	const alpha = exam({
		status: "ONGOING",
		type: "PRACTICE",
		title: "Alpha drill",
	});
	const completed = exam({
		status: "COMPLETED",
		type: "PRACTICE",
		title: "Finished drill",
	});

	const groups = groupExamsForStudent([zebra, alpha, completed], NOW);
	expect(titles(sectionOf(groups, "practice")?.exams ?? [])).toEqual([
		"Alpha drill",
		"Zebra drill",
	]);
});

test("Upcoming section: ordered by scheduledAt ascending, unscheduled exams last, PRACTICE excluded", () => {
	const early = exam({
		status: "SCHEDULED",
		type: "QUIZ",
		title: "Early quiz",
		scheduledAt: new Date("2026-01-05T09:00:00Z"),
	});
	const late = exam({
		status: "SCHEDULED",
		type: "EXAM",
		title: "Late final",
		scheduledAt: new Date("2026-05-05T09:00:00Z"),
	});
	const unscheduled = exam({
		status: "SCHEDULED",
		type: "EXAM",
		title: "Unscheduled exam",
		scheduledAt: null,
	});
	const practice = exam({
		status: "SCHEDULED",
		type: "PRACTICE",
		title: "Scheduled practice",
	});

	const groups = groupExamsForStudent(
		[unscheduled, late, early, practice],
		NOW,
	);
	expect(titles(sectionOf(groups, "upcoming")?.exams ?? [])).toEqual([
		"Early quiz",
		"Late final",
		"Unscheduled exam",
	]);
});

test("Past section: ordered by scheduledAt descending, unscheduled exams last, any type included", () => {
	const older = exam({
		status: "COMPLETED",
		type: "EXAM",
		title: "Older",
		scheduledAt: new Date("2026-01-01T09:00:00Z"),
	});
	const newer = exam({
		status: "COMPLETED",
		type: "PRACTICE",
		title: "Newer",
		scheduledAt: new Date("2026-03-01T09:00:00Z"),
	});
	const unscheduled = exam({
		status: "COMPLETED",
		type: "QUIZ",
		title: "Unscheduled past",
		scheduledAt: null,
	});

	const groups = groupExamsForStudent([older, unscheduled, newer], NOW);
	expect(titles(sectionOf(groups, "past")?.exams ?? [])).toEqual([
		"Newer",
		"Older",
		"Unscheduled past",
	]);
});

test("empty input yields no sections", () => {
	expect(groupExamsForStudent([], NOW)).toEqual([]);
});

test("grouping is a pure function: same input, same output, input left untouched", () => {
	const exams = [
		exam({ status: "ONGOING", type: "EXAM", title: "A" }),
		exam({ status: "SCHEDULED", type: "EXAM", title: "B" }),
	];
	const snapshot = JSON.stringify(exams);

	const first = groupExamsForStudent(exams, NOW);
	const second = groupExamsForStudent(exams, NOW);

	expect(JSON.stringify(exams)).toEqual(snapshot);
	expect(second).toEqual(first);
});

// ---------------------------------------------------------------------------
// Membership follows the clock, not only the stored status
// ---------------------------------------------------------------------------

/// 90 minutes plus 30 of extra time: the window runs 10:00 to 12:00 on `WINDOW_START`.
const WINDOW_START = new Date("2026-03-10T10:00:00Z");
const TIMED = {
	duration: { hours: 1, minutes: 30 },
	extraTime: { minutes: 30 },
};

function scheduledAt(minutesFromStart: number): Date {
	return new Date(WINDOW_START.getTime() + minutesFromStart * 60_000);
}

test("a SCHEDULED exam whose window has passed lands in Past", () => {
	const finished = exam({
		status: "SCHEDULED",
		title: "Finished",
		scheduledAt: WINDOW_START,
		...TIMED,
	});

	const groups = groupExamsForStudent([finished], scheduledAt(121));
	expect(groups.map((g) => g.key)).toEqual(["past"]);
	expect(titles(sectionOf(groups, "past")?.exams ?? [])).toEqual(["Finished"]);
});

test("a SCHEDULED exam inside its window lands in Open", () => {
	const running = exam({
		status: "SCHEDULED",
		title: "Running",
		scheduledAt: WINDOW_START,
		...TIMED,
	});

	const groups = groupExamsForStudent([running], scheduledAt(60));
	expect(groups.map((g) => g.key)).toEqual(["open"]);
	expect(titles(sectionOf(groups, "open")?.exams ?? [])).toEqual(["Running"]);
});

test("a SCHEDULED exam that has not started lands in Upcoming", () => {
	const later = exam({
		status: "SCHEDULED",
		title: "Later",
		scheduledAt: WINDOW_START,
		...TIMED,
	});

	const groups = groupExamsForStudent([later], scheduledAt(-1));
	expect(groups.map((g) => g.key)).toEqual(["upcoming"]);
	expect(titles(sectionOf(groups, "upcoming")?.exams ?? [])).toEqual(["Later"]);
});

test("an untimed SCHEDULED exam moves from Upcoming to Open at its start and stays there", () => {
	const untimed = exam({
		status: "SCHEDULED",
		title: "Untimed",
		scheduledAt: WINDOW_START,
	});

	const before = groupExamsForStudent([untimed], scheduledAt(-1));
	const atStart = groupExamsForStudent([untimed], WINDOW_START);
	const muchLater = groupExamsForStudent([untimed], scheduledAt(100_000));
	expect(before.map((g) => g.key)).toEqual(["upcoming"]);
	expect(atStart.map((g) => g.key)).toEqual(["open"]);
	expect(muchLater.map((g) => g.key)).toEqual(["open"]);
});

test("a SCHEDULED exam without a date stays in Upcoming whatever the clock says", () => {
	const undated = exam({ status: "SCHEDULED", title: "Undated", ...TIMED });

	const groups = groupExamsForStudent([undated], scheduledAt(100_000));
	expect(groups.map((g) => g.key)).toEqual(["upcoming"]);
});

test("an ONGOING timed exam moves to Past once its window has passed", () => {
	const ongoing = exam({
		status: "ONGOING",
		title: "Ongoing",
		scheduledAt: WINDOW_START,
		...TIMED,
	});

	expect(
		groupExamsForStudent([ongoing], scheduledAt(60)).map((g) => g.key),
	).toEqual(["open"]);
	expect(
		groupExamsForStudent([ongoing], scheduledAt(121)).map((g) => g.key),
	).toEqual(["past"]);
});

test("a scheduled PRACTICE exam stays in Practice after its window", () => {
	const drill = exam({
		status: "SCHEDULED",
		type: "PRACTICE",
		title: "Drill",
		scheduledAt: WINDOW_START,
		...TIMED,
	});

	const groups = groupExamsForStudent([drill], scheduledAt(10_000));
	expect(groups.map((g) => g.key)).toEqual(["practice"]);
});

test("extra time keeps an exam in Open past its plain duration", () => {
	const running = exam({
		status: "SCHEDULED",
		title: "Running",
		scheduledAt: WINDOW_START,
		...TIMED,
	});

	// 100 minutes in: past the 90 minute duration, inside the 30 minute extra time.
	const groups = groupExamsForStudent([running], scheduledAt(100));
	expect(groups.map((g) => g.key)).toEqual(["open"]);
});

test("without an explicit now, grouping uses the current clock", () => {
	const longGone = exam({
		status: "SCHEDULED",
		title: "Long gone",
		scheduledAt: new Date("2001-01-01T10:00:00Z"),
		...TIMED,
	});

	const groups = groupExamsForStudent([longGone]);
	expect(groups.map((g) => g.key)).toEqual(["past"]);
});
