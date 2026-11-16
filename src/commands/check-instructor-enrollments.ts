import { Command } from "commander";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";

export const checkInstructorEnrollmentsCommand = new Command(
	"check-instructor-enrollments",
)
	.description(
		"List the enrollments of a course's own instructor; exits 1 when there are any",
	)
	.option("--fix", "delete the ones without attempts")
	.action(async (options: { fix?: boolean }) => {
		const found = await db.enrollment.instructorEnrollments(
			{ fix: options.fix },
			FULL_ACCESS,
		);
		for (const e of found) {
			const state = e.removed ? "removed" : `${e.attempts} attempt(s)`;
			console.log(`${e.course}  ${e.username}  ${state}`);
		}
		const left = found.filter((e) => !e.removed);
		if (left.length > 0) process.exitCode = 1;
		else console.log("No instructor enrollments left.");
	});
