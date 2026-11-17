import { type PrismaTx, prisma } from "./client";

/**
 * The active sanctions of a course (or of the exams `examIds`), as `sanctionsByResponse` takes them.
 *
 * Reads no permission and hides nothing: only for callers that authorize the
 * whole grades view themselves, never for a student's reads. Those callers
 * include a BOT key reading the course grades, which `exam-sanction.read`
 * refuses, so they cannot go through the service.
 */
export async function activeSanctionsOf(
	course: number,
	examIds?: number[],
	client: Pick<PrismaTx, "examSanction"> = prisma,
): Promise<
	{
		response: string;
		question: string | null;
		factor: string;
		reason: string | null;
	}[]
> {
	const rows = await client.examSanction.findMany({
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
			factor: true,
			reason: true,
			response: { select: { publicId: true } },
			questionRef: { select: { slug: true } },
		},
	});
	return rows.map((row) => ({
		response: row.response.publicId,
		question: row.questionRef?.slug ?? null,
		factor: row.factor,
		reason: row.reason,
	}));
}
