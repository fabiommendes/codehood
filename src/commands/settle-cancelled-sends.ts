import { Command } from "commander";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { parseCourseSegment } from "@/urls";

export const settleCancelledSendsCommand = new Command("settle-cancelled-sends")
	.description(
		"Mark as not graded the code sends whose job was cancelled by a newer send and that still wait for a grade",
	)
	.requiredOption("--course <course>", "e.g. cs101/ada_2026-2")
	.option("--dry-run", "count what would be marked and write nothing")
	.action(async (options: { course: string; dryRun?: boolean }) => {
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
			const { settled } = await db.gradingJob.settleCancelled(
				{ course: { discipline, ...segment }, dryRun: options.dryRun },
				FULL_ACCESS,
			);
			const verb = options.dryRun ? "would mark" : "marked";
			console.log(`${verb} ${settled} send(s) as not graded`);
		} catch (error) {
			console.error(error instanceof Error ? error.message : error);
			process.exitCode = 1;
		}
	});
