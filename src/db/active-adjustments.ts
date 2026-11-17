import type { ExamAdjustmentOp } from "@/core/schemas/exam-adjustment";
import { type PrismaTx, prisma } from "./client";

/**
 * The active adjustments of a course (or of the exams `examIds`), as `adjustmentsByResponse` takes them.
 *
 * Reads no permission and hides nothing: only for callers that authorize the
 * whole grades view themselves, never for a student's reads. Those callers
 * include a BOT key reading the course grades, which `exam-adjustment.read`
 * refuses, so they cannot go through the service.
 */
export async function activeAdjustmentsOf(
	course: number,
	examIds?: number[],
	client: Pick<PrismaTx, "examAdjustment"> = prisma,
): Promise<
	{
		response: string;
		question: string | null;
		op: ExamAdjustmentOp;
		value: string;
		reason: string | null;
	}[]
> {
	const rows = await client.examAdjustment.findMany({
		where: {
			revokedAt: null,
			response: {
				exam: {
					courseId: course,
					...(examIds === undefined ? {} : { id: { in: examIds } }),
				},
			},
		},
		select: {
			op: true,
			value: true,
			reason: true,
			response: { select: { publicId: true } },
			questionRef: { select: { slug: true } },
		},
	});
	return rows.map((row) => ({
		response: row.response.publicId,
		question: row.questionRef?.slug ?? null,
		op: row.op,
		value: row.value,
		reason: row.reason,
	}));
}
