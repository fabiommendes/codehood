import { type ResultPolicy, resultPolicy } from "@/services/exam-result";
import { type PrismaTx, prisma } from "./client";

/**
 * Loads the discount of every `code` question of a course and returns the
 * policy of any of its exams.
 *
 * One query per course, however many exams it has. Inside a transaction, pass
 * its `tx` as `client`.
 *
 * @example
 * const policyOf = await loadResultPolicy(course.id);
 * examResult(slugs, submissions, feedback, policyOf(exam));
 */
export async function loadResultPolicy(
	courseId: number,
	client: Pick<PrismaTx, "questionRef"> = prisma,
): Promise<(exam: { type: string }) => ResultPolicy> {
	const rows = await client.questionRef.findMany({
		where: { courseId, penalty: { not: null } },
		select: { slug: true, penalty: true },
	});
	const penalties: Record<string, number> = {};
	for (const row of rows) {
		const penalty = Number(row.penalty);
		if (Number.isFinite(penalty)) penalties[row.slug] = penalty;
	}
	return (exam) => resultPolicy(exam.type, penalties);
}
