/**
 * The weekly pattern half of a course's schedule. Writes are ownership-gated
 * (the `course.update-contents` permission); reads follow course-contents
 * visibility (`course.read-contents`). A slot is never archived — deleting
 * one with events attached is refused, naming the count.
 */
import type { z } from "zod";
import { hasPerm } from "@/auth/permissions";
import { NotAllowed } from "@/core/error";
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
import { CrudBase, type ServiceOptsWithoutTx } from "@/db/base-service";
import {
	durationToMinutes,
	toClockTime,
	toDuration,
	toMinutes,
} from "@/utils/schedule-time";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
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

export class TimeSlotService extends CrudBase<{
	entity: TimeSlot;
	pkFilter: TimeSlotPK;
	create: TimeSlotCreate;
	filter: TimeSlotFilter;
	update: TimeSlotUpdate;
}> {
	/**
	 * Creates a time slot.
	 *
	 * Rejects a zero-length slot, one running past midnight, and a second
	 * slot in the same course overlapping an existing one on the same
	 * weekday.
	 */
	@Validate({
		service: true,
		returns: timeSlotSchema,
		args: [undefined, timeSlotCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: TimeSlotCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<TimeSlot> {
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
	}

	/**
	 * Finds a slot by id, by `(courseId, slug)`, or by its course's natural key
	 * plus `slug`.
	 *
	 * Throws `NotAllowed` if it exists but `actor` may not see its course's
	 * contents, and `NotFound` when the filter names a course that does not
	 * exist; returns `null` for a course that exists without that slug.
	 */
	@Validate({
		service: true,
		returns: timeSlotSchema.nullable(),
		args: [undefined, timeSlotPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: TimeSlotPK,
		opts: ServiceOptsWithoutTx,
	): Promise<TimeSlot | null> {
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
	}

	/**
	 * Lists the slots of one course, narrowed to what `actor` may see, ordered
	 * by weekday then start time so the syllabus line reads Monday-first.
	 */
	@Validate({
		service: true,
		returns: timeSlotSchema.array(),
		args: [undefined, timeSlotFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: TimeSlotFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<TimeSlot[]> {
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
	}

	/**
	 * Changes `title`, `day`, `start`, or `duration`. Never `slug`.
	 *
	 * A slot's existing events keep their own times: moving the hour here
	 * does not move a single row in `CalendarEvent` (see "Week numbers are
	 * authored" in the spec) — the CLI plans that as its own writes.
	 */
	@Validate({
		service: true,
		returns: timeSlotSchema,
		args: [undefined, timeSlotPK, timeSlotUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: TimeSlotPK,
		fields: TimeSlotUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<TimeSlot> {
		const current = await writableSlot(
			tx,
			filter,
			opts.actor,
			"time-slot.update",
		);

		const day = fields.day ?? current.day;
		const startMin = fields.start ? toMinutes(fields.start) : current.startMin;
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
		return fromDb(row);
	}

	/**
	 * Upserts a time slot keyed on `{courseId, slug}`.
	 *
	 * PUT semantics: gated on the `course.update-contents` permission whether
	 * creating or updating, same as `create`/`update`; the overlap check
	 * re-runs on whichever branch fires.
	 */
	@Validate({
		service: true,
		returns: timeSlotSchema,
		args: [undefined, timeSlotCreate],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: TimeSlotCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<TimeSlot> {
		const course = await writableCourse(tx, input.course, opts.actor);
		const scoped = { ...opts, tx };

		const existing = await tx.timeSlot.findUnique({
			where: { courseId_slug: { courseId: course.id, slug: input.slug } },
			select: { id: true },
		});
		if (!existing) return this.create({ ...input, course: course.id }, scoped);

		const { slug: _slug, course: _course, ...fields } = input;
		return this.update({ course: course.id, slug: input.slug }, fields, scoped);
	}

	/**
	 * Deletes a time slot.
	 *
	 * Refuses one that still has events, naming the count — the same
	 * pattern as `editionService.delete` refusing an edition in use.
	 */
	@Validate({ service: true, args: [undefined, timeSlotPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: TimeSlotPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
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
			throw new Error(
				`Slot "${current.slug}" still has ${eventCount} event(s) and cannot be deleted.`,
			);
		}
		await tx.timeSlot.delete({ where: { id: current.id } });
	}
}

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

/** A slot lasts at least a minute and does not run past midnight. */
function validateWindow(startMin: number, durationMin: number): void {
	if (durationMin <= 0) {
		throw new Error("A time slot's duration must be greater than zero.");
	}
	if (startMin + durationMin > 1440) {
		throw new Error("A time slot cannot run past midnight.");
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
		throw new Error(`This slot overlaps slot "${collision.slug}" on ${day}.`);
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
