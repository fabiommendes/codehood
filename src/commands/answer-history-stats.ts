import { Command } from "commander";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import type {
	AnswerHistoryExamStats,
	AnswerHistoryReport,
} from "@/db/services/answer-edit.service";
import { parseCourseSegment } from "@/urls";

/// Column headers and what each one reads from a line of the report.
const COLUMNS: [string, (line: AnswerHistoryExamStats) => number][] = [
	["attempts", (l) => l.attempts],
	["with history", (l) => l.withHistory],
	["incomplete", (l) => l.incomplete],
	["edits", (l) => l.edits],
	["counted bytes", (l) => l.countedBytes],
	["stored bytes", (l) => l.storedBytes],
	["median stored", (l) => l.medianStoredBytes],
	["max stored", (l) => l.maxStoredBytes],
];

/**
 * Formats the report of `course`, as a table or, with `json`, as one JSON line.
 *
 * Sizes are bytes. The median and the maximum are per attempt, over the
 * attempts that have a history.
 */
export function renderAnswerHistoryReport(
	course: string,
	report: AnswerHistoryReport,
	options: { json: boolean },
): string {
	if (options.json) return JSON.stringify({ course, ...report });

	const lines = [...report.exams, { exam: "total", ...report.total }];
	const width = Math.max(4, ...lines.map((l) => l.exam.length));
	const header = [
		"exam".padEnd(width),
		...COLUMNS.map(([name]) => name.padStart(name.length)),
	].join("  ");
	const body = lines.map((line) =>
		[
			line.exam.padEnd(width),
			...COLUMNS.map(([name, pick]) =>
				String(pick(line)).padStart(name.length),
			),
		].join("  "),
	);
	return [
		`Answer edit history of ${course}`,
		header,
		...body.slice(0, -1),
		"-".repeat(header.length),
		...body.slice(-1),
	].join("\n");
}

export const answerHistoryStatsCommand = new Command("answer-history-stats")
	.description(
		"Print how much edit history of answers each exam of a course holds",
	)
	.argument("<course>", "e.g. cs101/ada_2026-2")
	.argument("[exam]", "an exam slug; every exam of the course when omitted")
	.option("--json", "print one line of JSON")
	.action(
		async (
			course: string,
			exam: string | undefined,
			options: { json?: boolean },
		) => {
			const [discipline = "", rest = ""] = course.split("/");
			const segment = parseCourseSegment(rest);
			if (!discipline || !segment) {
				console.error(
					`"${course}" is not a course: expected <discipline>/<instructor>_<edition>.`,
				);
				process.exitCode = 1;
				return;
			}

			try {
				const report = await db.answerEdit.stats(
					{ course: { discipline, ...segment }, exam },
					FULL_ACCESS,
				);
				console.log(
					renderAnswerHistoryReport(course, report, { json: !!options.json }),
				);
			} catch (error) {
				console.error(error instanceof Error ? error.message : error);
				process.exitCode = 1;
			}
		},
	);
