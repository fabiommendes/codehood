/**
 * Assignments of a course: long-running work delivered by pushing to a git
 * repository the server hosts for each team. Writes need
 * `course.update-contents`; reads follow `course.read-contents`, and an
 * assignment that has not opened yet is visible only to who writes the course.
 */
import type { z } from "zod";
import { hasPerm } from "@/auth/permissions";
import {
	ASSIGNMENT_MAX_FILE_BYTES,
	ASSIGNMENT_MAX_REPO_BYTES,
} from "@/core/constants";
import { InvalidData, NotAllowed } from "@/core/error";
import {
	type AssignmentPK,
	type AssignmentRestrictions,
	assignmentFilter,
	assignmentPK,
	assignmentRemove,
	assignmentRuleIssues,
	assignmentSchema,
	assignmentUpsert,
} from "@/core/schemas/assignment";
import type { CourseId } from "@/core/schemas/base";
import type { ServiceOpts, ServiceOptsWithoutTx } from "@/db/base-service";
import {
	checkExpectedUpdatedAt,
	checkVersion,
	guardedDelete,
	guardedUpdate,
} from "@/db/conditional-write";
import { defineService, inTx, op } from "@/db/define-service";
import { m } from "@/i18n";
import * as bare from "@/services/git/bare";
import {
	type Assignment,
	assignmentInclude,
	canSeeAssignment,
	checkpointsOf,
	findAssignment,
	isIndividual,
	toAssignment,
	visibleAssignment,
} from "../assignment-access";
import {
	DbNull,
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";
import { enrollmentsOf } from "../course-access";
import { courseRefWhere, valueOrNotFound } from "../utils";

export type { Assignment } from "../assignment-access";
export type AssignmentUpsert = z.infer<typeof assignmentUpsert>;
export type { AssignmentPK };
export type AssignmentFilter = z.infer<typeof assignmentFilter>;
export type AssignmentRemove = z.infer<typeof assignmentRemove>;

/// What the service needs from the disk: dropping the repository of a team.
export type AssignmentDisk = Pick<typeof bare, "removeBareRepository">;

/**
 * The assignment service of `client` (the shared client by default).
 *
 * Besides the operations it carries `remove`, which deletes folders after its
 * transaction closes and so cannot be an operation of the builder.
 */
export function makeAssignmentService(
	disk: AssignmentDisk = bare,
	client: PrismaClient = prisma,
) {
	/**
	 * Finds an assignment by id or by `(course, slug)`.
	 *
	 * @throws {@link NotFound} If it does not exist, or the actor may not see
	 * it: the course is closed to them, or it has not opened yet and they
	 * cannot write the course.
	 */
	const findOne = op({
		transaction: false,
		returns: assignmentSchema,
		args: [assignmentPK],
		run: async (
			tx: PrismaTx,
			pk: AssignmentPK,
			opts: ServiceOptsWithoutTx,
		): Promise<Assignment> =>
			toAssignment(await visibleAssignment(tx, pk, opts.actor)),
	});

	/**
	 * Lists the assignments of a course the actor sees, by deadline.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 * @throws {@link NotAllowed} `assignment.read` if the actor lacks
	 * `course.read-contents` on the course.
	 */
	const findMany = op({
		transaction: false,
		returns: assignmentSchema.array(),
		args: [assignmentFilter],
		run: async (
			tx: PrismaTx,
			filter: AssignmentFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<Assignment[]> => {
			const course = await courseOf(tx, filter.course, opts);
			if (!hasPerm(opts.actor, "course.read-contents", course)) {
				throw new NotAllowed("assignment.read");
			}
			const now = new Date();
			const canWrite = hasPerm(opts.actor, "course.update-contents", course);
			const rows = await tx.assignment.findMany({
				where: {
					courseId: course.id,
					...(canWrite
						? {}
						: { OR: [{ opensAt: null }, { opensAt: { lte: now } }] }),
				},
				include: assignmentInclude(opts.actor),
				orderBy: [{ dueAt: "asc" }, { slug: "asc" }],
			});
			return rows
				.filter((row) => canSeeAssignment(row, opts.actor, now))
				.map(toAssignment);
		},
	});

	/**
	 * Creates the assignment `(course, slug)`, or updates it: a field left
	 * `undefined` keeps its stored value and `null` clears it.
	 *
	 * Mutating the sizes of an assignment that has teams leaves them as they
	 * are, but it cannot switch between individual and team work.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 * @throws {@link NotAllowed} `assignment.create` if the actor lacks
	 * `course.update-contents`.
	 * @throws {@link InvalidData} If the template is no repository of the
	 * course, a restriction exceeds the limits of the instance, the merged
	 * sizes, dates and checkpoints break a rule, or the switch above is attempted.
	 */
	const upsert = op({
		returns: assignmentSchema,
		args: [assignmentUpsert],
		run: async (
			tx: PrismaTx,
			input: AssignmentUpsert,
			opts: ServiceOptsWithoutTx,
		): Promise<Assignment> => {
			const course = await courseOf(tx, input.course, opts);
			if (!hasPerm(opts.actor, "course.update-contents", course)) {
				throw new NotAllowed("assignment.create");
			}
			const existing = await tx.assignment.findUnique({
				where: { courseId_slug: { courseId: course.id, slug: input.slug } },
				include: assignmentInclude(opts.actor),
			});

			const checkpoints =
				input.checkpoints === undefined
					? undefined
					: [...(input.checkpoints ?? [])].sort(
							(a, b) => a.at.getTime() - b.at.getTime(),
						);
			const merged = {
				teamMin: input.teamMin ?? existing?.teamMin ?? 1,
				teamMax: input.teamMax ?? existing?.teamMax ?? 1,
				opensAt: pick(input.opensAt, existing?.opensAt),
				dueAt: input.dueAt,
				closesAt: pick(input.closesAt, existing?.closesAt),
				teamsLockAt: pick(input.teamsLockAt, existing?.teamsLockAt),
				checkpoints: checkpoints ?? (existing ? checkpointsOf(existing) : []),
			};
			InvalidData.ensureNoError(
				Object.fromEntries(
					assignmentRuleIssues(merged).map((issue) => [
						issue.path,
						[{ code: "invalid" as const, message: issue.message }],
					]),
				),
			);
			checkRestrictions(input.restrictions);

			if (existing && isIndividual(existing) !== (merged.teamMax === 1)) {
				const teams = await tx.team.count({
					where: { assignmentId: existing.id },
				});
				if (teams > 0) {
					throw new InvalidData({
						teamMax: [
							{ code: "invalid", message: m.errors_assignment_mode_locked() },
						],
					});
				}
			}

			const templateId = await templateOf(tx, course.id, input.template);
			const restrictions =
				input.restrictions === undefined
					? undefined
					: input.restrictions === null
						? DbNull
						: (input.restrictions as Prisma.InputJsonObject);
			const fields = {
				title: input.title,
				body: input.body,
				opensAt: input.opensAt,
				dueAt: input.dueAt,
				closesAt: input.closesAt,
				teamMin: merged.teamMin,
				teamMax: merged.teamMax,
				teamsLockAt: input.teamsLockAt,
				templateId,
				restrictions,
				checkpoints:
					checkpoints === undefined
						? undefined
						: checkpoints.length === 0
							? DbNull
							: checkpoints.map((c) => ({ ...c, at: c.at.toISOString() })),
				rev: input.rev,
			};
			const include = assignmentInclude(opts.actor);

			if (!existing) {
				checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
				const row = await tx.assignment.create({
					data: { courseId: course.id, slug: input.slug, ...fields },
					include,
				});
				return toAssignment(row);
			}
			const row = await guardedUpdate(
				tx,
				"assignment",
				{ id: existing.id },
				fields,
				opts,
				{ include },
			);
			return toAssignment(row);
		},
	});

	/// The database half of `remove`: the ids of the teams whose folders go.
	const removeRows = op({
		args: [assignmentPK, assignmentRemove],
		run: async (
			tx: PrismaTx,
			pk: AssignmentPK,
			input: AssignmentRemove,
			opts: ServiceOptsWithoutTx,
		): Promise<number[]> => {
			const row = await findAssignment(tx, pk, opts.actor);
			if (!row) {
				checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
				return [];
			}
			if (!hasPerm(opts.actor, "course.update-contents", row.course)) {
				throw new NotAllowed("assignment.delete");
			}
			await checkVersion(tx, "assignment", { id: row.id }, opts);
			const teams = await tx.team.findMany({
				where: { assignmentId: row.id },
				select: { id: true },
			});
			if (teams.length > 0 && !input.force) {
				throw new NotAllowed("assignment.delete", {
					status: 409,
					message: m.errors_assignment_has_teams(),
				});
			}
			await guardedDelete(tx, "assignment", { id: row.id }, opts);
			return teams.map((team) => team.id);
		},
	});

	/**
	 * Deletes the assignment, its teams and their repository folders.
	 *
	 * Without `force`, an assignment that has teams is refused with status 409.
	 * The folders are deleted after the transaction closes, never inside it; a
	 * folder that survives is left to `prune-team-repositories`. A missing assignment
	 * is a no-op.
	 *
	 * @throws {@link NotAllowed} `assignment.delete` if the actor lacks
	 * `course.update-contents`, or the assignment has teams and no `force`.
	 */
	async function remove(
		pk: AssignmentPK,
		input: AssignmentRemove,
		opts: ServiceOpts,
	): Promise<void> {
		const folders = await inTx(client, opts, (tx, scoped) =>
			removeRows(tx, pk, input, scoped),
		);
		await Promise.allSettled(
			folders.map((id) => disk.removeBareRepository(id)),
		);
	}

	const crud = defineService()(() => ({ findOne, findMany, upsert }))(client);
	return { ...crud, remove };
}

/** The assignment service, as built by {@link makeAssignmentService}. */
export type AssignmentService = ReturnType<typeof makeAssignmentService>;

//
// Private utilities -------------------------------------------------------
//

/// The course `ref` names, with what the permission rules read.
async function courseOf(
	tx: PrismaTx,
	ref: AssignmentUpsert["course"],
	opts: ServiceOptsWithoutTx,
) {
	return valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
			select: {
				id: true,
				instructor: { select: { username: true } },
				enrollments: enrollmentsOf(opts.actor),
			},
		}),
	);
}

/// `input` when the caller said something (`null` included), else what is stored.
function pick<T>(input: T | null | undefined, stored: T | null | undefined) {
	return input === undefined ? (stored ?? null) : input;
}

/// Refuses a size above the limit of the instance.
function checkRestrictions(
	restrictions: AssignmentRestrictions | null | undefined,
) {
	if (!restrictions) return;
	const limits = {
		maxFileBytes: ASSIGNMENT_MAX_FILE_BYTES,
		maxRepoBytes: ASSIGNMENT_MAX_REPO_BYTES,
	} as const;
	const errors: Record<string, { code: "too-long"; message: string }[]> = {};
	for (const key of ["maxFileBytes", "maxRepoBytes"] as const) {
		const value = restrictions[key];
		if (value !== undefined && value > limits[key]) {
			errors[`restrictions.${key}`] = [
				{
					code: "too-long",
					message: m.errors_assignment_restriction_over_limit({
						limit: limits[key],
					}),
				},
			];
		}
	}
	InvalidData.ensureNoError(errors);
}

/// The id of the repository `slug` of the course, `null` to clear, `undefined` to keep.
async function templateOf(
	tx: PrismaTx,
	courseId: CourseId,
	slug: string | null | undefined,
): Promise<number | null | undefined> {
	if (slug === undefined || slug === null) return slug;
	const repository = await tx.repository.findUnique({
		where: { courseId_slug: { courseId, slug } },
		select: { id: true },
	});
	if (!repository) {
		throw new InvalidData({
			template: [
				{ code: "not-exists", message: m.errors_assignment_template_unknown() },
			],
		});
	}
	return repository.id;
}
