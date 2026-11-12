import { expect, test } from "@playwright/test";
import { renderAnswerHistoryReport } from "@/commands/answer-history-stats";
import type { AnswerHistoryReport } from "@/db/services/answer-edit.service";

const row = {
	attempts: 10,
	withHistory: 8,
	incomplete: 1,
	fields: 16,
	batches: 40,
	gaps: 2,
	edits: 1234,
	countedBytes: 2000,
	storedBytes: 1100,
	medianStoredBytes: 100,
	maxStoredBytes: 300,
};

const report: AnswerHistoryReport = {
	exams: [
		{ exam: "midterm", ...row },
		{ exam: "final", ...row, attempts: 2, withHistory: 0, storedBytes: 0 },
	],
	total: { ...row, attempts: 12 },
};

test("the JSON output is one line the report parses back from", () => {
	const out = renderAnswerHistoryReport("cs101/ada_2026-2", report, {
		json: true,
	});
	expect(out.includes("\n")).toBe(false);
	expect(JSON.parse(out)).toEqual({ course: "cs101/ada_2026-2", ...report });
});

test("the text output has a line per exam and a total line", () => {
	const out = renderAnswerHistoryReport("cs101/ada_2026-2", report, {
		json: false,
	});
	const lines = out.split("\n");
	expect(lines[0]).toContain("cs101/ada_2026-2");
	const midterm = lines.find((l) => l.startsWith("midterm"));
	expect(midterm).toBeDefined();
	for (const n of ["10", "8", "1234", "2000", "1100", "100", "300"]) {
		expect(midterm).toContain(n);
	}
	expect(lines.find((l) => l.startsWith("final"))).toBeDefined();
	expect(lines.at(-1)).toMatch(/^total/);
	expect(lines.at(-1)).toContain("12");
});

test("a course without exams still prints a total", () => {
	const empty: AnswerHistoryReport = {
		exams: [],
		total: {
			...row,
			attempts: 0,
			withHistory: 0,
			incomplete: 0,
			fields: 0,
			batches: 0,
			gaps: 0,
			edits: 0,
			countedBytes: 0,
			storedBytes: 0,
			medianStoredBytes: 0,
			maxStoredBytes: 0,
		},
	};
	expect(renderAnswerHistoryReport("c/u_2026", empty, { json: false })).toMatch(
		/total/,
	);
});
