import { ensurePerm } from "@/auth/permissions";
import type { CourseId } from "@/core/schemas";
import type { CourseNaturalKey } from "@/urls";
import type { ServiceOptsWithoutTx } from "./base-service";
import type { Prisma, PrismaTx } from "./client";
import { courseRefWhere, valueOrNotFound } from "./utils";

/**
 * Loads the course `ref` names with what the permission rules need (its
 * instructor and `ACTIVE` enrollments), optionally requiring `select.perm`.
 *
 * @throws {@link NotFound} If the course cannot be found.
 * @throws {@link NotAllowed} If `opts.actor` lacks `select.perm` on the course.
 */
export async function courseAccess<StartDate extends boolean = true>(
	tx: PrismaTx,
	ref: CourseNaturalKey | CourseId,
	opts: ServiceOptsWithoutTx,
	select?: {
		startDate?: StartDate;
		perm?: "course.read" | "course.read-contents" | "course.update-contents";
	},
): Promise<
	Prisma.CourseGetPayload<{
		select: {
			id: true;
			instructor: { select: { username: true } };
			enrollments: { select: { username: true } };
			startDate: StartDate extends true ? true : false;
		};
	}>
> {
	const course = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
			select: {
				id: true,
				instructor: { select: { username: true } },
				startDate: select?.startDate ?? true,
				enrollments: {
					where: { status: "ACTIVE" },
					select: { username: true },
				},
			},
		}),
	);

	if (select?.perm) ensurePerm(opts.actor, select.perm, course);

	// biome-ignore lint/suspicious/noExplicitAny: intentional cast for flexible return type
	return course as any;
}
