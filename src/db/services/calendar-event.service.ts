/**
 * The dated half of a course's schedule. Writes are ownership-gated (the
 * `course.update-contents` permission); reads follow course-contents
 * visibility (`course.read-contents`). An event's time is always derived
 * from its course's `startAt`, its `week`, and its slot's day and start —
 * never authored directly.
 */
import type { z } from "zod";
import { hasPerm } from "@/auth/permissions";
import { NotAllowed } from "@/core/error";
import {
	type CalendarEventId,
	type CourseId,
	calendarEventCreate,
	calendarEventFilter,
	calendarEventPK,
	calendarEventSchema,
	calendarEventUpdate,
	type TimeSlotId,
} from "@/core/schemas";
import { CrudBase, type ServiceOptsWithoutTx } from "@/db/base-service";
import {
	dateOffsetBy,
	endOf,
	toClockTime,
	toDuration,
	weekdayOnOrAfter,
} from "@/utils/schedule-time";
import { Validate } from "@/utils/validate";
import type { Prisma, PrismaTx } from "../client";
import { courseRefWhere, valueOrNotAllowed, valueOrNotFound } from "../utils";
import { courseContentsWhere } from "./course.service";

export type { CalendarEventId } from "@/core/schemas";
export type { Weekday } from "../client";

//
// Type definitions
//
export type CalendarEventCreate = z.infer<typeof calendarEventCreate>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type CalendarEventFilter = z.infer<typeof calendarEventFilter>;
export type CalendarEventPK = z.infer<typeof calendarEventPK>;
export type CalendarEventUpdate = z.infer<typeof calendarEventUpdate>;
export type EventKind = CalendarEvent["kind"];

/** True for the one kind that represents an actual meeting. */
const MEETING_KINDS: ReadonlySet<EventKind> = new Set(["REGULAR"]);

/** The minimal shape every read loads: the owning course and the slot. */
const EVENT_INCLUDE = {
	course: {
		select: {
			instructor: { select: { username: true } },
			enrollments: {
				where: { status: "ACTIVE" as const },
				select: { username: true },
			},
		},
	},
	timeSlot: true,
} satisfies Prisma.CalendarEventInclude;

type DbEvent = Prisma.CalendarEventGetPayload<{
	include: typeof EVENT_INCLUDE;
}>;

export class CalendarEventService extends CrudBase<{
	entity: CalendarEvent;
	pkFilter: CalendarEventPK;
	create: CalendarEventCreate;
	filter: CalendarEventFilter;
	update: CalendarEventUpdate;
}> {
	/**
	 * Creates an event on `input.timeSlot` in `input.week` of `input.course`.
	 *
	 * `startAt` and `durationMin` are always derived: the slot's weekday in
	 * the course's first week, offset by `week` whole weeks, at the slot's
	 * own start time. Rejects a slot belonging to another course.
	 */
	@Validate({
		service: true,
		returns: calendarEventSchema,
		args: [undefined, calendarEventCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: CalendarEventCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<CalendarEvent> {
		const course = await writableCourse(tx, input.course, opts.actor);

		const slot = await tx.timeSlot.findFirst({
			where:
				typeof input.timeSlot === "number"
					? { id: input.timeSlot }
					: { courseId: course.id, slug: input.timeSlot },
		});

		if (!slot || slot.courseId !== course.id) {
			throw new Error(
				`Time slot ${input.timeSlot} does not belong to course ${course.id}.`,
			);
		}

		// Start with the slot's weekday in the course's first week, at 00:00
		// local time, then offset by the authored week and the slot's own
		// start time.
		let timestamp = weekdayOnOrAfter(course.startAt, slot.day);
		timestamp.setHours(0, 0, 0, 0);
		timestamp = dateOffsetBy(timestamp, {
			days: input.week * 7,
			minutes: slot.startMin,
		});

		const row = await tx.calendarEvent.create({
			data: {
				courseId: course.id,
				timeSlotId: slot.id,
				startAt: timestamp,
				durationMin: slot.durationMin,
				week: input.week,
				kind: input.kind ?? "REGULAR",
				title: input.title,
				description: input.description,
				ref: input.ref,
			},
			include: EVENT_INCLUDE,
		});
		return fromDb(row);
	}

	/**
	 * Finds an event by id, or by `(courseId, week, timeSlot)`.
	 *
	 * Throws `NotAllowed` if it exists but `actor` may not see its course's
	 * contents; returns `null` if it does not exist.
	 */
	@Validate({
		service: true,
		returns: calendarEventSchema.nullable(),
		args: [undefined, calendarEventPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: CalendarEventPK,
		opts: ServiceOptsWithoutTx,
	): Promise<CalendarEvent | null> {
		const row = await tx.calendarEvent.findFirst({
			where: await eventWhere(tx, filter),
			include: EVENT_INCLUDE,
		});
		if (!row) return null;

		if (!hasPerm(opts.actor, "course.read-contents", row.course)) {
			throw new NotAllowed("calendar-event.read");
		}
		return fromDb(row);
	}

	/**
	 * Lists events narrowed to what `actor` may see (see the
	 * `course.read-contents` permission).
	 *
	 * The course is given either as `courseIds` or as its natural key; with
	 * neither, returns everything the actor may see, which is what
	 * `/calendar` wants. `from` is inclusive of an event still running at
	 * that instant, applied after the database query since it depends on
	 * `durationMin`; every other filter is a plain `where`. Ordered by
	 * `startAt`.
	 */
	@Validate({
		service: true,
		returns: calendarEventSchema.array(),
		args: [undefined, calendarEventFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: CalendarEventFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<CalendarEvent[]> {
		const courseIds = await scopedCourseIds(tx, filter);

		const rows = await tx.calendarEvent.findMany({
			where: {
				AND: [
					courseIds ? { courseId: { in: courseIds } } : {},
					filter.kinds ? { kind: { in: filter.kinds } } : {},
					filter.weeks ? { week: { in: filter.weeks } } : {},
					filter.to !== undefined ? { startAt: { lt: filter.to } } : {},
					{ course: courseContentsWhere(opts.actor) },
				],
			},
			include: EVENT_INCLUDE,
			orderBy: { startAt: "asc" },
		});

		for (const row of rows) {
			if (!hasPerm(opts.actor, "course.read-contents", row.course)) {
				throw new NotAllowed("calendar-event.read");
			}
		}

		const from = filter.from;
		const inWindow =
			from !== undefined
				? rows.filter((r) => endOf(r.startAt, r.durationMin) >= from)
				: rows;
		const limited =
			filter.limit !== undefined ? inWindow.slice(0, filter.limit) : inWindow;
		return limited.map(fromDb);
	}

	/**
	 * Changes `title`/`description`/`kind`/`ref`. The event's time is never
	 * writable here — it is always derived from the course, week, and slot.
	 */
	@Validate({
		service: true,
		returns: calendarEventSchema,
		args: [undefined, calendarEventPK, calendarEventUpdate],
	})
	protected async updateTx(
		tx: PrismaTx,
		filter: CalendarEventPK,
		fields: CalendarEventUpdate,
		opts: ServiceOptsWithoutTx,
	): Promise<CalendarEvent> {
		const current = await writableEvent(
			tx,
			filter,
			opts.actor,
			"calendar-event.update",
		);

		const row = await tx.calendarEvent.update({
			where: { id: current.id },
			data: {
				title: fields.title,
				description: fields.description,
				kind: fields.kind,
				ref: fields.ref,
			},
			include: EVENT_INCLUDE,
		});
		return fromDb(row);
	}

	/**
	 * Upserts an event keyed on `{courseId, week, timeSlot}`.
	 *
	 * PUT semantics: gated on the `course.update-contents` permission whether
	 * creating or updating, same as `create`/`update`.
	 */
	@Validate({
		service: true,
		returns: calendarEventSchema,
		args: [undefined, calendarEventCreate],
	})
	protected async upsertTx(
		tx: PrismaTx,
		input: CalendarEventCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<CalendarEvent> {
		const course = await writableCourse(tx, input.course, opts.actor);
		const scoped = { ...opts, tx };

		const slot = await tx.timeSlot.findFirst({
			where:
				typeof input.timeSlot === "number"
					? { id: input.timeSlot }
					: { courseId: course.id, slug: input.timeSlot },
		});
		if (!slot || slot.courseId !== course.id) {
			throw new Error(
				`Time slot ${input.timeSlot} does not belong to course ${course.id}.`,
			);
		}

		const existing = await tx.calendarEvent.findUnique({
			where: {
				courseId_week_timeSlotId: {
					courseId: course.id,
					week: input.week,
					timeSlotId: slot.id,
				},
			},
			select: { id: true },
		});
		if (!existing) return this.create({ ...input, course: course.id }, scoped);

		const {
			course: _course,
			timeSlot: _timeSlot,
			week: _week,
			...fields
		} = input;
		return this.update(
			{ course: course.id, week: input.week, timeSlot: input.timeSlot },
			fields,
			scoped,
		);
	}

	/**
	 * Removes the row outright — events are never archived (FR-CAL-014).
	 *
	 * A subsequent `findOne` returns `null`.
	 */
	@Validate({ service: true, args: [undefined, calendarEventPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: CalendarEventPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const current = await writableEvent(
			tx,
			filter,
			opts.actor,
			"calendar-event.delete",
		);
		await tx.calendarEvent.delete({ where: { id: current.id } });
	}
}

//
// Auxiliary functions
//

/// The courses a listing is narrowed to, or `null` for every course the actor
/// may read. A natural key that matches no course narrows to nothing.
async function scopedCourseIds(
	tx: PrismaTx,
	filter: CalendarEventFilter,
): Promise<number[] | null> {
	if (!("course" in filter)) return filter.courseIds ?? null;

	const course = await tx.course.findUnique({
		where: courseRefWhere(filter.course),
		select: { id: true },
	});
	return [valueOrNotFound("course", course).id];
}

/** The `where` matching whichever of the primary keys `filter` carries. */
async function eventWhere(
	tx: PrismaTx,
	filter: CalendarEventPK,
): Promise<Prisma.CalendarEventWhereInput> {
	if ("id" in filter) return { id: filter.id };

	const courseId = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(filter.course),
			select: { id: true },
		}),
	).id;

	return {
		courseId,
		week: filter.week,
		...(typeof filter.timeSlot === "number"
			? { timeSlotId: filter.timeSlot }
			: { timeSlot: { slug: filter.timeSlot } }),
	};
}

/** Finds the course a write targets, refusing an actor who may not write its contents. */
async function writableCourse(
	tx: PrismaTx,
	ref: CalendarEventCreate["course"],
	actor: ServiceOptsWithoutTx["actor"],
) {
	return valueOrNotAllowed(
		"calendar-event.create",
		valueOrNotFound(
			"course",
			await tx.course.findUnique({
				where: courseRefWhere(ref),
				select: {
					id: true,
					startAt: true,
					instructor: { select: { username: true } },
				},
			}),
		),
		(c) => hasPerm(actor, "course.update-contents", c),
	);
}

/**
 * Finds the event a write targets, refusing an actor who may not write to its course.
 */
async function writableEvent(
	tx: PrismaTx,
	filter: CalendarEventPK,
	actor: ServiceOptsWithoutTx["actor"],
	action: "calendar-event.update" | "calendar-event.delete",
) {
	const event = valueOrNotFound(
		"calendar-event",
		await tx.calendarEvent.findFirst({
			where: await eventWhere(tx, filter),
			select: {
				id: true,
				course: { select: { instructor: { select: { username: true } } } },
			},
		}),
	);

	if (!hasPerm(actor, "course.update-contents", event.course)) {
		throw new NotAllowed(action);
	}
	return event;
}

/** Converts a database row into the calendar event entity. */
function fromDb(row: DbEvent): CalendarEvent {
	const { course: _course, timeSlot, ...rest } = row;
	return {
		...rest,
		id: rest.id as CalendarEventId,
		courseId: rest.courseId as CourseId,
		timeSlot: {
			id: timeSlot.id as TimeSlotId,
			slug: timeSlot.slug,
			day: timeSlot.day,
			start: toClockTime(timeSlot.startMin),
			duration: toDuration(timeSlot.durationMin),
		},
	};
}

/** Whether `kind` represents a meeting that was actually held. */
export function isMeeting(kind: EventKind): boolean {
	return MEETING_KINDS.has(kind);
}
