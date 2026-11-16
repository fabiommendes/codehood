import { Command } from "commander";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import type { ObjectiveGradingLine } from "@/db/services/response.service";
import { parseCourseSegment } from "@/urls";

/**
 * Formats what `response.gradeObjectives` did, one line per exam and a total.
 *
 * @example
 * renderObjectiveGrading([{ exam: "p1", attempts: 3, graded: 5, released: false }], false)
 */
export function renderObjectiveGrading(
	lines: readonly ObjectiveGradingLine[],
	dryRun: boolean,
): string {
	if (lines.length === 0) return "Nothing to grade.";
	const verb = dryRun ? "would grade" : "graded";
	const body = lines.map(
		(line) =>
			`${line.exam}: ${verb} ${line.graded} answer(s) of ${line.attempts} attempt(s)${line.released ? " (grades released)" : ""}`,
	);
	const total = lines.reduce((sum, line) => sum + line.graded, 0);
	return [...body, `total: ${verb} ${total} answer(s)`].join("\n");
}

export const gradeObjectivesCommand = new Command("grade-objectives")
	.description(
		"Grade the objective answers of closed attempts that the server did not grade on closing",
	)
	.requiredOption("--course <course>", "e.g. cs101/ada_2026-2")
	.option(
		"--exam <exam>",
		"an exam slug; every exam of the course when omitted",
	)
	.option("--dry-run", "count what would be graded and write nothing")
	.option("--released", "include exams whose grades were already released")
	.action(
		async (options: {
			course: string;
			exam?: string;
			dryRun?: boolean;
			released?: boolean;
		}) => {
			const [discipline = "", rest = ""] = options.course.split("/");
			const segment = parseCourseSegment(rest);
			if (!discipline || !segment) {
				console.error(
					`"${options.course}" is not a course: expected <discipline>/<instructor>_<edition>.`,
				);
				process.exitCode = 1;
				return;
			}

			try {
				const lines = await db.response.gradeObjectives(
					{
						course: { discipline, ...segment },
						exam: options.exam,
						dryRun: options.dryRun,
						released: options.released,
					},
					FULL_ACCESS,
				);
				console.log(renderObjectiveGrading(lines, !!options.dryRun));
			} catch (error) {
				console.error(error instanceof Error ? error.message : error);
				process.exitCode = 1;
			}
		},
	);
