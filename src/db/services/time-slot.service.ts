/**
 * The weekly pattern half of a course's schedule. Writes are ownership-gated
 * (the `course.update-contents` permission); reads follow course-contents
 * visibility (`course.read-contents`). A slot is never archived — deleting
 * one with events attached is refused, naming the count.
 */
import type { z } from "zod";
import { hasPerm } from "@/auth/permissions";
import { InvalidData, NotAllowed } from "@/core/error";
import {
	type CourseId,
	type courseNaturalKey,
	type TimeSlotId,
	timeSlotCreate,
	timeSlotFilter,
	timeSlotPK,
	timeSlotSchema,
	timeSlotUpdate,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import {
	durationToMinutes,
	toClockTime,
	toDuration,
	toMinutes,
} from "@/utils/schedule-time";
import type { Prisma, PrismaTx } from "../client";
import { recomputeEventTimes } from "../event-times";
import { courseRefWhere, valueOrNotAllowed, valueOrNotFound } from "../utils";

export type { TimeSlotId } from "@/core/schemas";
export { weekdaySchema } from "@/core/schemas";

//
// Type definitions
//
export type TimeSlotCreate = z.infer<typeof timeSlotCreate>;
export type TimeSlot = z.infer<typeof timeSlotSchema>;
export type TimeSlotFilter = z.infer<typeof timeSlotFilter>;
export type TimeSlotPK = z.infer<typeof timeSlotPK>;
export type TimeSlotUpdate = z.infer<typeof timeSlotUpdate>;
export type TimeSlotRef = z.infer<typeof courseNaturalKey> & { slug: string };

type DbTimeSlot = Prisma.TimeSlotGetPayload<{
	include: typeof timeSlotInclude;
}>;

/** The minimal course shape the write/read predicates need, loaded alongside every row. */
const timeSlotInclude = {
	course: {
		select: {
			instructor: { select: { username: true } },
			enrollments: {
				where: { status: "ACTIVE" as const },
				select: { username: true },
			},
		},
	},
} satisfies Prisma.TimeSlotInclude;

/// The CRUD shape of the time slot service.
type TimeSlotT = {
	entity: TimeSlot;
	pkFilter: TimeSlotPK;
	create: TimeSlotCreate;
	filter: TimeSlotFilter;
	update: TimeSlotUpdate;
};

/** The time slot service of `client` (the shared client by default). */
export const makeTimeSlotService = defineService<TimeSlotT>()(() => {
	/**
	 * Creates a time slot.
	 *
	 * Rejects a zero-length slot, one running past midnight, and a second
	 * slot in the same course overlapping an existing one on the same
	 * weekday.
	 */
	const create = op({
		args: [timeSlotCreate],
		returns: timeSlotSchema,
		run: async (
			tx: PrismaTx,
			input: TimeSlotCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<TimeSlot> => {
			const course = await writableCourse(tx, input.course, opts.actor);
			const startMin = toMinutes(input.start);
			const durationMin = durationToMinutes(input.duration);
			validateWindow(startMin, durationMin);
			await assertNoOverlap(tx, course.id, input.day, startMin, durationMin);

			const row = await tx.timeSlot.create({
				data: {
					courseId: course.id,
					slug: input.slug,
					title: input.title,
					day: input.day,
					startMin,
					durationMin,
				},
				include: timeSlotInclude,
			});
			return fromDb(row);
		},
	});

	/**
	 * Finds a slot by id, by `(courseId, slug)`, or by its course's natural key
	 * plus `slug`.
	 *
	 * Throws `NotAllowed` if it exists but `actor` may not see its course's
	 * contents, and `NotFound` when the filter names a course that does not
	 * exist; returns `null` for a course that exists without that slug.
	 */
	const findOne = op({
		transaction: false,
		args: [timeSlotPK],
		returns: timeSlotSchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: TimeSlotPK,
			opts: ServiceOptsWithoutTx,
		): Promise<TimeSlot | null> => {
			const row = await tx.timeSlot.findFirst({
				where: timeSlotWhere(filter),
				include: timeSlotInclude,
			});
			if (!row) {
				if (!("id" in filter)) await assertCourseExists(tx, filter);
				return null;
			}

			if (!hasPerm(opts.actor, "course.read-contents", row.course)) {
				throw new NotAllowed("time-slot.read");
			}

			return fromDb(row);
		},
	});

	/**
	 * Lists the slots of one course, narrowed to what `actor` may see, ordered
	 * by weekday then start time so the syllabus line reads Monday-first.
	 */
	const findMany = op({
		transaction: false,
		args: [timeSlotFilter],
		returns: timeSlotSchema.array(),
		run: async (
			tx: PrismaTx,
			filter: TimeSlotFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<TimeSlot[]> => {
			const course = valueOrNotFound(
				"course",
				await tx.course.findUnique({
					where: courseRefWhere(filter.course),
					select: {
						id: true,
						instructor: { select: { username: true } },
						enrollments: {
							where: { status: "ACTIVE" as const },
							select: { username: true },
						},
					},
				}),
			);

			if (!hasPerm(opts.actor, "course.read-contents", course)) {
				throw new NotAllowed("time-slot.read");
			}

			const rows = await tx.timeSlot.findMany({
				where: {
					courseId: course.id,
					...(filter.days ? { day: { in: filter.days } } : {}),
				},
				include: timeSlotInclude,
				orderBy: [{ day: "asc" }, { startMin: "asc" }],
			});
			return rows.map(fromDb);
		},
	});

	/**
	 * Changes `title`, `day`, `start`, or `duration`. Never `slug`.
	 *
	 * The slot's events move with it: their `startAt` and `durationMin` are
	 * recomputed in the same transaction.
	 */
	const update = op({
		args: [timeSlotPK, timeSlotUpdate],
		returns: timeSlotSchema,
		run: async (
			tx: PrismaTx,
			filter: TimeSlotPK,
			fields: TimeSlotUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<TimeSlot> => {
			const current = await writableSlot(
				tx,
				filter,
				opts.actor,
				"time-slot.update",
			);

			const day = fields.day ?? current.day;
			const startMin = fields.start
				? toMinutes(fields.start)
				: current.startMin;
			const durationMin = fields.duration
				? durationToMinutes(fields.duration)
				: current.durationMin;
			validateWindow(startMin, durationMin);
			await assertNoOverlap(tx, current.courseId, day, startMin, durationMin, {
				excludeId: current.id,
			});

			const row = await tx.timeSlot.update({
				where: { id: current.id },
				data: {
					title: fields.title,
					day: fields.day,
					startMin: fields.start ? startMin : undefined,
					durationMin: fields.duration ? durationMin : undefined,
				},
				include: timeSlotInclude,
			});
			if (fields.day || fields.start || fields.duration) {
				await recomputeEventTimes(tx, { timeSlotId: current.id });
			}
			return fromDb(row);
		},
	});

	/**
	 * Upserts a time slot keyed on `{courseId, slug}`.
	 *
	 * PUT semantics: gated on the `course.update-contents` permission whether
	 * creating or updating, same as `create`/`update`; the overlap check
	 * re-runs on whichever branch fires.
	 */
	const upsert = op({
		args: [timeSlotCreate],
		returns: timeSlotSchema,
		run: async (
			tx: PrismaTx,
			input: TimeSlotCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<TimeSlot> => {
			const course = await writableCourse(tx, input.course, opts.actor);

			const existing = await tx.timeSlot.findUnique({
				where: { courseId_slug: { courseId: course.id, slug: input.slug } },
				select: { id: true },
			});
			if (!existing) return create(tx, { ...input, course: course.id }, opts);

			const { slug: _slug, course: _course, ...fields } = input;
			return update(tx, { course: course.id, slug: input.slug }, fields, opts);
		},
	});

	/**
	 * Deletes a time slot.
	 *
	 * Refuses one that still has events, naming the count — the same
	 * pattern as `editionService.delete` refusing an edition in use.
	 */
	const remove = op({
		args: [timeSlotPK],
		run: async (
			tx: PrismaTx,
			filter: TimeSlotPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			const current = await writableSlot(
				tx,
				filter,
				opts.actor,
				"time-slot.delete",
			);

			const eventCount = await tx.calendarEvent.count({
				where: { timeSlotId: current.id },
			});
			if (eventCount > 0) {
				throw new NotAllowed("time-slot.delete", {
					status: 409,
					message: m.errors_time_slot_has_events({
						slug: current.slug,
						count: eventCount,
					}),
				});
			}
			await tx.timeSlot.delete({ where: { id: current.id } });
		},
	});

	return { create, findOne, findMany, update, upsert, delete: remove };
});

//
// Auxiliary functions
//

/** The `where` matching whichever of the primary keys `filter` carries. */
function timeSlotWhere(filter: TimeSlotPK): Prisma.TimeSlotWhereInput {
	if ("id" in filter) return { id: filter.id };

	return {
		slug: filter.slug,
		course:
			typeof filter.course === "number"
				? { id: filter.course }
				: {
						disciplineSlug: filter.course.discipline,
						instructorId: filter.course.instructor,
						editionSlug: filter.course.edition,
					},
	};
}

/** Throws `NotFound` when a slot's course reference resolves to no course. */
async function assertCourseExists(
	tx: PrismaTx,
	filter: Exclude<TimeSlotPK, { id: TimeSlotId }>,
): Promise<void> {
	valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(filter.course),
			select: { id: true },
		}),
	);
}

/** Finds the course a slot is written to, refusing an actor who may not write its contents. */
async function writableCourse(
	tx: PrismaTx,
	ref: TimeSlotCreate["course"],
	actor: ServiceOptsWithoutTx["actor"],
) {
	return valueOrNotAllowed(
		"time-slot.create",
		valueOrNotFound(
			"course",
			await tx.course.findUnique({
				where: courseRefWhere(ref),
				select: { id: true, instructor: { select: { username: true } } },
			}),
		),
		(c) => hasPerm(actor, "course.update-contents", c),
	);
}

/**
 * Finds the slot a write targets, refusing an actor who may not write to its course.
 */
async function writableSlot(
	tx: PrismaTx,
	filter: TimeSlotPK,
	actor: ServiceOptsWithoutTx["actor"],
	action: "time-slot.update" | "time-slot.delete",
) {
	const slot = valueOrNotFound(
		"time-slot",
		await tx.timeSlot.findFirst({
			where: timeSlotWhere(filter),
			select: {
				id: true,
				courseId: true,
				slug: true,
				day: true,
				startMin: true,
				durationMin: true,
				course: { select: { instructor: { select: { username: true } } } },
			},
		}),
	);

	if (!hasPerm(actor, "course.update-contents", slot.course)) {
		throw new NotAllowed(action);
	}
	return slot;
}

/**
 * Refuses a slot shorter than a minute or one that runs past midnight.
 *
 * @throws {@link InvalidData} On `duration` or `start`.
 */
function validateWindow(startMin: number, durationMin: number): void {
	if (durationMin <= 0) {
		throw new InvalidData({
			duration: [
				{ code: "invalid", message: m.errors_time_slot_duration_positive() },
			],
		});
	}
	if (startMin + durationMin > 1440) {
		throw new InvalidData({
			start: [{ code: "invalid", message: m.errors_time_slot_past_midnight() }],
		});
	}
}

/** Whether `[aStart, aStart+aDuration)` and `[bStart, bStart+bDuration)` intersect. */
function minutesOverlap(
	aStart: number,
	aDuration: number,
	bStart: number,
	bDuration: number,
): boolean {
	return aStart < bStart + bDuration && bStart < aStart + aDuration;
}

/**
 * Refuses a slot that overlaps a sibling on the same weekday in the same
 * course. `excludeId` lets an update or upsert's own row through.
 *
 * @throws {@link InvalidData} On `start`.
 */
async function assertNoOverlap(
	tx: PrismaTx,
	courseId: number,
	day: TimeSlotCreate["day"],
	startMin: number,
	durationMin: number,
	opts?: { excludeId?: number },
): Promise<void> {
	const siblings = await tx.timeSlot.findMany({
		where: {
			courseId,
			day,
			...(opts?.excludeId !== undefined ? { NOT: { id: opts.excludeId } } : {}),
		},
		select: { slug: true, startMin: true, durationMin: true },
	});
	const collision = siblings.find((s) =>
		minutesOverlap(startMin, durationMin, s.startMin, s.durationMin),
	);
	if (collision) {
		throw new InvalidData({
			start: [
				{
					code: "invalid",
					message: m.errors_time_slot_overlap({ slug: collision.slug, day }),
				},
			],
		});
	}
}

/** Converts a database row into the time slot entity. */
function fromDb(row: DbTimeSlot): TimeSlot {
	const { course: _course, startMin, durationMin, ...rest } = row;
	return {
		...rest,
		id: rest.id as TimeSlotId,
		courseId: rest.courseId as CourseId,
		start: toClockTime(startMin),
		duration: toDuration(durationMin),
	};
}
