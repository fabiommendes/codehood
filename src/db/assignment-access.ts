import type { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import { hasPerm } from "@/auth/permissions";
import { NotFound } from "@/core/error";
import {
	type AssignmentCheckpoint,
	type AssignmentPK,
	type AssignmentRestrictions,
	assignmentCheckpoint,
	assignmentRestrictions,
	type assignmentSchema,
} from "@/core/schemas/assignment";
import type { AssignmentId, CourseId } from "@/core/schemas/base";
import type { Prisma, PrismaTx } from "./client";
import { enrollmentsOf } from "./course-access";
import { courseRefMatch } from "./utils";

/// What the assignment and team services share: loading an assignment with the
/// course the permission rules read, and who may see it.

export type Assignment = z.infer<typeof assignmentSchema>;

/// What every read of an assignment loads. `enrollments` stands for the
/// narrowed relation `assignmentInclude` builds.
const INCLUDE_SHAPE = {
	course: {
		select: {
			id: true,
			instructor: { select: { username: true } },
			enrollments: { select: { username: true } },
		},
	},
	template: { select: { id: true, slug: true, head: true } },
} satisfies Prisma.AssignmentInclude;

export type DbAssignment = Prisma.AssignmentGetPayload<{
	include: typeof INCLUDE_SHAPE;
}>;

/// The `include` that loads an assignment for `actor`: its course carries only
/// the actor's own active enrollment, which is all the permission rules ask.
export function assignmentInclude(actor: Actor): typeof INCLUDE_SHAPE {
	return {
		...INCLUDE_SHAPE,
		course: {
			select: {
				...INCLUDE_SHAPE.course.select,
				enrollments: enrollmentsOf(actor),
			},
		},
	};
}

/// The `where` matching the assignment `pk` names.
export function assignmentWhere(pk: AssignmentPK): Prisma.AssignmentWhereInput {
	if ("id" in pk) return { id: pk.id };
	return { slug: pk.slug, course: courseRefMatch(pk.course) };
}

/// The assignment `pk` names, whether or not `actor` may see it.
export function findAssignment(
	tx: PrismaTx,
	pk: AssignmentPK,
	actor: Actor,
): Promise<DbAssignment | null> {
	return tx.assignment.findFirst({
		where: assignmentWhere(pk),
		include: assignmentInclude(actor),
	});
}

/// Whether `actor` sees `row`: it reads the course, and the assignment has
/// opened unless the actor writes the course.
export function canSeeAssignment(
	row: DbAssignment,
	actor: Actor,
	now: Date = new Date(),
): boolean {
	if (!hasPerm(actor, "course.read-contents", row.course)) return false;
	if (row.opensAt === null || row.opensAt <= now) return true;
	return hasPerm(actor, "course.update-contents", row.course);
}

/**
 * The assignment `pk` names, as far as `actor` may see it.
 *
 * @throws {@link NotFound} If it does not exist, or `actor` may not see it.
 */
export async function visibleAssignment(
	tx: PrismaTx,
	pk: AssignmentPK,
	actor: Actor,
): Promise<DbAssignment> {
	const row = await findAssignment(tx, pk, actor);
	if (!row || !canSeeAssignment(row, actor)) throw new NotFound("assignment");
	return row;
}

/// Whether `actor` is a student of the course with an active enrollment.
export function isEnrolledStudent(row: DbAssignment, actor: Actor): boolean {
	return (
		actor !== SYSTEM &&
		row.course.instructor.username !== actor.username &&
		row.course.enrollments.some((e) => e.username === actor.username)
	);
}

/// The instant teams stop forming and changing: `teamsLockAt`, or the deadline.
export function teamsLockInstant(
	row: Pick<DbAssignment, "teamsLockAt" | "dueAt">,
): Date {
	return row.teamsLockAt ?? row.dueAt;
}

/// Whether the teams of `row` no longer change by the students' hand.
export function teamsAreLocked(
	row: Pick<DbAssignment, "teamsLockAt" | "dueAt">,
	now: Date = new Date(),
): boolean {
	return now >= teamsLockInstant(row);
}

/// Whether `row` is an individual assignment: teams of one.
export function isIndividual(row: Pick<DbAssignment, "teamMax">): boolean {
	return row.teamMax === 1;
}

/// The restrictions stored in `row`, or `null`.
export function restrictionsOf(
	row: Pick<DbAssignment, "restrictions">,
): AssignmentRestrictions | null {
	return row.restrictions === null
		? null
		: assignmentRestrictions.parse(row.restrictions);
}

/// The checkpoints stored in `row`, ordered by `at`; empty when it has none.
export function checkpointsOf(
	row: Pick<DbAssignment, "checkpoints">,
): AssignmentCheckpoint[] {
	return row.checkpoints === null
		? []
		: assignmentCheckpoint.array().parse(row.checkpoints);
}

/// The read model of an assignment row.
export function toAssignment(row: DbAssignment): Assignment {
	return {
		id: row.id as AssignmentId,
		courseId: row.courseId as CourseId,
		slug: row.slug,
		title: row.title,
		body: row.body,
		opensAt: row.opensAt,
		dueAt: row.dueAt,
		closesAt: row.closesAt,
		teamMin: row.teamMin,
		teamMax: row.teamMax,
		teamsLockAt: row.teamsLockAt,
		template: row.template?.slug ?? null,
		restrictions: restrictionsOf(row),
		checkpoints: checkpointsOf(row),
		rev: row.rev,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}
