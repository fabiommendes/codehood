import { expect, test } from "@playwright/test";
import type { Exam } from "@/db";
import { courseHomeExams } from "@/services/course-home";
import type { ExceptionTiming } from "@/services/exam-state";

const DAY = 86_400_000;

const NOW = new Date("2026-03-10T10:00:00Z");

/// `NOW` shifted by `days`.
function inDays(days: number): Date {
	return new Date(NOW.getTime() + days * DAY);
}

let nextId = 1;

/// A scheduled, untimed exam of the given slug, overridable field by field.
function exam(slug: string, overrides: Partial<Exam> = {}): Exam {
	return {
		id: nextId++ as Exam["id"],
		slug,
		type: "EXAM",
		status: "SCHEDULED",
		title: slug,
		description: null,
		preamble: null,
		format: "PLAINTEXT",
		scheduledAt: null,
		duration: null,
		extraTime: null,
		gradesReleasedAt: null,
		author: "ada",
		rev: null,
		tags: [],
		questions: [],
		createdAt: NOW,
		updatedAt: NOW,
		...overrides,
	};
}

const NONE = new Map<string, number>();

/// The previewed slugs in order, so a case reads as a sequence.
function slugs(preview: ReturnType<typeof courseHomeExams>): string[] {
	return preview.exams.map(({ exam }) => exam.slug);
}

const open = exam("open", { status: "ONGOING", scheduledAt: inDays(-1) });
const soon = exam("soon", { scheduledAt: inDays(2) });
const later = exam("later", { scheduledAt: inDays(9) });
const past = exam("past", { status: "COMPLETED", scheduledAt: inDays(-30) });
const draft = exam("draft", { status: "DRAFT", scheduledAt: inDays(5) });
const undatedDraft = exam("undated-draft", { status: "DRAFT" });
const practice = exam("practice", { type: "PRACTICE" });

test("open exams come first, then the upcoming ones by date", () => {
	const preview = courseHomeExams([later, soon, open, past], NONE, NOW);

	expect(preview.title).toBe("Exams");
	expect(slugs(preview)).toEqual(["open", "soon", "later"]);
});

test("a closed exam with answers to grade sits between the open and the upcoming ones", () => {
	const preview = courseHomeExams(
		[soon, past, open],
		new Map([["past", 4]]),
		NOW,
	);

	expect(slugs(preview)).toEqual(["open", "past", "soon"]);
	expect(preview.exams[1]?.pending).toBe(4);
});

test("dated drafts join the upcoming exams only for the instructor", () => {
	const exams = [later, draft, undatedDraft, soon];

	expect(slugs(courseHomeExams(exams, NONE, NOW))).toEqual(["soon", "later"]);
	expect(
		slugs(courseHomeExams(exams, NONE, NOW, { withDrafts: true })),
	).toEqual(["soon", "draft", "later"]);
});

test("with nothing open, upcoming or to grade, practice exams stand in", () => {
	const preview = courseHomeExams([past, practice], NONE, NOW);

	expect(preview.title).toBe("Practice");
	expect(slugs(preview)).toEqual(["practice"]);
});

test("a course with no exams previews none", () => {
	expect(courseHomeExams([], NONE, NOW).exams).toEqual([]);
});

//
// Personal timing
//

test("a student's extra time reopens an exam closed for the class in the preview", () => {
	// Closed an hour ago; the student's 90 extra minutes end in 30.
	const extra = exam("extra", {
		scheduledAt: new Date(NOW.getTime() - 2 * 3_600_000),
		duration: { minutes: 60 },
	});
	const personal: ExceptionTiming = {
		extraTime: { minutes: 90 },
		scheduledAt: null,
	};

	expect(slugs(courseHomeExams([soon, extra], NONE, NOW))).toEqual(["soon"]);
	expect(
		slugs(
			courseHomeExams([soon, extra], NONE, NOW, {
				exceptions: new Map([["extra", personal]]),
			}),
		),
	).toEqual(["extra", "soon"]);
});

test("a makeup moves a past exam into the student's upcoming ones, by the personal date", () => {
	const missed = exam("missed", {
		status: "COMPLETED",
		scheduledAt: inDays(-30),
		duration: { minutes: 60 },
	});
	const makeup: ExceptionTiming = { extraTime: null, scheduledAt: inDays(5) };

	const preview = courseHomeExams([later, missed, soon], NONE, NOW, {
		exceptions: new Map([["missed", makeup]]),
	});

	expect(slugs(preview)).toEqual(["soon", "missed", "later"]);
});
