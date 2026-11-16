/**
 * Prints, as one JSON line, what the pages read of the database in
 * `DATABASE_URL`: the home sections of a few seeded users and the question
 * statistics of every graded exam of the seeded courses.
 *
 * The loaders open the process-wide client, which a spec cannot point at
 * another file, so `test/seed-states.spec.ts` runs this in a child process on
 * its copy of the seeded database.
 */
import type { UserActor } from "@/auth/actor";
import { prisma } from "@/db/client";
import { loadResultPolicy } from "@/db/result-policy";
import { questionStats } from "@/services/question-stats";
import { loadExamGrading } from "@/utils/load-grading";
import { loadInstructorHome } from "@/utils/load-instructor-home";
import { loadStudentHome } from "@/utils/load-student-home";

async function actorOf(username: string): Promise<UserActor> {
	const user = await prisma.user.findUniqueOrThrow({ where: { username } });
	return { username: user.username, name: user.name, role: user.role };
}

const now = new Date();

const student = await loadStudentHome(await actorOf("student"), now);
const homes: Record<string, unknown> = { student };
for (const username of ["ada", "alan", "instructor"]) {
	homes[username] = await loadInstructorHome(await actorOf(username), now);
}

const ada = await actorOf("ada");
const stats: Record<string, Record<string, unknown>> = {};
for (const course of await prisma.course.findMany({
	where: { instructorId: "ada" },
})) {
	const policyOf = await loadResultPolicy(course.id);
	for (const { slug, type } of await prisma.exam.findMany({
		where: { courseId: course.id },
	})) {
		if (type === "PRACTICE") continue;
		const grading = await loadExamGrading(course.id, slug, ada);
		if (!grading) continue;
		const { exam, questions, attempts, feedback, exceptions } = grading;
		stats[slug] = Object.fromEntries(
			questionStats(
				exam,
				questions,
				attempts,
				feedback,
				now,
				exceptions,
				policyOf(exam),
			).map((entry) => [
				entry.question,
				{
					discrimination: entry.discrimination,
					gap: entry.discriminationGap,
				},
			]),
		);
	}
}

console.log(`SEED_REPORT ${JSON.stringify({ homes, stats })}`);
await prisma.$disconnect();
