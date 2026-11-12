/**
 * The dated half of a course's schedule. Writes are ownership-gated (the
 * `course.update-contents` permission); reads follow course-contents
 * visibility (`course.read-contents`). An event's time is always derived
 * from its course's `startAt`, its `week`, and its slot's day and start —
 * never authored directly.
 */
import type { z } from "zod";
import { ensurePerm, hasPerm } from "@/auth/permissions";
import { InvalidData, NotAllowed } from "@/core/error";
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
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import {
	checkExpectedUpdatedAt,
	checkVersion,
	guardedDelete,
	guardedUpdate,
	touch,
} from "@/db/conditional-write";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import {
	endOf,
	slotInstant,
	toClockTime,
	toDuration,
} from "@/utils/schedule-time";
import type { Prisma, PrismaTx } from "../client";
import { recomputeEventTimes } from "../event-times";
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

/** The minimal shape every read loads: the owning course, the slot and the cited repositories. */
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
	repositories: {
		select: { repository: { select: { slug: true, title: true } } },
		orderBy: { repository: { slug: "asc" as const } },
	},
} satisfies Prisma.CalendarEventInclude;

type DbEvent = Prisma.CalendarEventGetPayload<{
	include: typeof EVENT_INCLUDE;
}>;

/// The CRUD shape of the calendar event service.
type CalendarEventT = {
	entity: CalendarEvent;
	pkFilter: CalendarEventPK;
	create: CalendarEventCreate;
	filter: CalendarEventFilter;
	update: CalendarEventUpdate;
};

/** The calendar event service of `client` (the shared client by default). */
export const makeCalendarEventService = defineService<CalendarEventT>()(() => {
	/**
	 * Creates an event on `input.timeSlot` in `input.week` of `input.course`.
	 *
	 * `startAt` and `durationMin` are always derived: the slot's weekday in
	 * the course's first week, offset by `week` whole weeks, at the slot's
	 * own start time. Rejects a slot belonging to another course.
	 */
	const create = op({
		args: [calendarEventCreate],
		returns: calendarEventSchema,
		run: async (
			tx: PrismaTx,
			input: CalendarEventCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<CalendarEvent> => {
			const course = await writableCourse(tx, input.course, opts.actor);

			const slot = await tx.timeSlot.findFirst({
				where:
					typeof input.timeSlot === "number"
						? { id: input.timeSlot }
						: { courseId: course.id, slug: input.timeSlot },
			});

			if (!slot || slot.courseId !== course.id) {
				throw new InvalidData({
					timeSlot: [
						{
							code: "not-exists",
							message: m.errors_time_slot_wrong_course({
								slot: String(input.timeSlot),
								course: course.id,
							}),
						},
					],
				});
			}

			const timestamp = slotInstant(
				course.startAt,
				slot.day,
				input.week,
				slot.startMin,
			);

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
					rev: input.rev,
				},
				include: EVENT_INCLUDE,
			});
			if (input.repositories == null) return fromDb(row);

			await setRepositories(tx, row.id, course.id, input.repositories);
			return fromDb(await reload(tx, row.id));
		},
	});

	/**
	 * Finds an event by id, or by `(courseId, week, timeSlot)`.
	 *
	 * Throws `NotAllowed` if it exists but `actor` may not see its course's
	 * contents; returns `null` if it does not exist.
	 */
	const findOne = op({
		transaction: false,
		args: [calendarEventPK],
		returns: calendarEventSchema.nullable(),
		run: async (
			tx: PrismaTx,
			filter: CalendarEventPK,
			opts: ServiceOptsWithoutTx,
		): Promise<CalendarEvent | null> => {
			const row = await tx.calendarEvent.findFirst({
				where: await eventWhere(tx, filter),
				include: EVENT_INCLUDE,
			});
			if (!row) return null;

			if (!hasPerm(opts.actor, "course.read-contents", row.course)) {
				throw new NotAllowed("calendar-event.read");
			}
			return fromDb(row);
		},
	});

	/**
	 * Lists events narrowed to what `actor` may see (see the
	 * `course.read-contents` permission).
	 *
	 * The course is given either as `courseIds` or as its natural key; with
	 * neither, returns everything the actor may see, which is what
	 * `/calendar` wants. `from` is inclusive of an event still running at
	 * that instant: the query keeps events starting at most a day before it,
	 * the longest a slot lasts, and the exact cut uses `durationMin` after
	 * the query. Every other filter is a plain `where`. Ordered by `startAt`.
	 */
	const findMany = op({
		transaction: false,
		args: [calendarEventFilter],
		returns: calendarEventSchema.array(),
		run: async (
			tx: PrismaTx,
			filter: CalendarEventFilter,
			opts: ServiceOptsWithoutTx,
		): Promise<CalendarEvent[]> => {
			const courseIds = await scopedCourseIds(tx, filter);

			const rows = await tx.calendarEvent.findMany({
				where: {
					AND: [
						courseIds ? { courseId: { in: courseIds } } : {},
						filter.kinds ? { kind: { in: filter.kinds } } : {},
						filter.weeks ? { week: { in: filter.weeks } } : {},
						filter.to !== undefined ? { startAt: { lt: filter.to } } : {},
						filter.from !== undefined
							? {
									startAt: {
										gte: new Date(filter.from.getTime() - LONGEST_SLOT_MS),
									},
								}
							: {},
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
		},
	});

	/**
	 * Changes `title`/`description`/`kind`/`rev`, and replaces the cited
	 * repositories when `repositories` is given (`[]` clears them, `null` or
	 * omitted keeps them). The event's time is never writable here — it is
	 * always derived from the course, week, and slot.
	 *
	 * @throws {@link InvalidData} If a slug in `repositories` is not a
	 * repository of the event's course.
	 */
	const update = op({
		args: [calendarEventPK, calendarEventUpdate],
		returns: calendarEventSchema,
		run: async (
			tx: PrismaTx,
			filter: CalendarEventPK,
			fields: CalendarEventUpdate,
			opts: ServiceOptsWithoutTx,
		): Promise<CalendarEvent> => {
			const current = await writableEvent(
				tx,
				filter,
				opts,
				"calendar-event.update",
			);

			// Always writes, so a change to the repositories alone moves `updatedAt`.
			const row = await guardedUpdate(
				tx,
				"calendarEvent",
				{ id: current.id },
				{
					title: fields.title,
					description: fields.description,
					kind: fields.kind,
					rev: fields.rev,
				},
				opts,
				{ include: EVENT_INCLUDE },
			);
			if (fields.repositories == null) return fromDb(row);

			await setRepositories(tx, row.id, current.courseId, fields.repositories);
			return fromDb(await reload(tx, row.id));
		},
	});

	/**
	 * Recomputes the `startAt` and `durationMin` of every event from its
	 * course, slot and week, and returns how many changed.
	 *
	 * Repairs events written under an older rule; a no-op once they agree.
	 *
	 * @throws NotAllowed when the actor lacks `system.manage`.
	 */
	const recomputeTimes = op({
		run: async (tx: PrismaTx, opts: ServiceOptsWithoutTx): Promise<number> => {
			ensurePerm(opts.actor, "system.manage");
			return recomputeEventTimes(tx, {});
		},
	});

	/**
	 * Upserts an event keyed on `{courseId, week, timeSlot}`.
	 *
	 * PUT semantics: gated on the `course.update-contents` permission whether
	 * creating or updating, same as `create`/`update`.
	 */
	const upsert = op({
		args: [calendarEventCreate],
		returns: calendarEventSchema,
		run: async (
			tx: PrismaTx,
			input: CalendarEventCreate,
			opts: ServiceOptsWithoutTx,
		): Promise<CalendarEvent> => {
			const course = await writableCourse(tx, input.course, opts.actor);

			const slot = await tx.timeSlot.findFirst({
				where:
					typeof input.timeSlot === "number"
						? { id: input.timeSlot }
						: { courseId: course.id, slug: input.timeSlot },
			});
			if (!slot || slot.courseId !== course.id) {
				throw new InvalidData({
					timeSlot: [
						{
							code: "not-exists",
							message: m.errors_time_slot_wrong_course({
								slot: String(input.timeSlot),
								course: course.id,
							}),
						},
					],
				});
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
			if (!existing) {
				checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
				return create(tx, { ...input, course: course.id }, opts);
			}

			const {
				course: _course,
				timeSlot: _timeSlot,
				week: _week,
				...fields
			} = input;
			return update(
				tx,
				{ course: course.id, week: input.week, timeSlot: input.timeSlot },
				fields,
				opts,
			);
		},
	});

	/**
	 * Removes the row outright — events are never archived.
	 *
	 * A subsequent `findOne` returns `null`. The resources that pointed at the
	 * event are detached from it and get a new `updatedAt`.
	 *
	 * @throws {@link NotAllowed} With status 409 if the event has a roll call.
	 */
	const remove = op({
		args: [calendarEventPK],
		run: async (
			tx: PrismaTx,
			filter: CalendarEventPK,
			opts: ServiceOptsWithoutTx,
		): Promise<void> => {
			const current = await writableEvent(
				tx,
				filter,
				opts,
				"calendar-event.delete",
			);
			await checkVersion(tx, "calendarEvent", { id: current.id }, opts);
			if ((await tx.rollCall.count({ where: { eventId: current.id } })) > 0) {
				throw new NotAllowed("calendar-event.delete", {
					status: 409,
					message: m.errors_event_has_roll_call(),
				});
			}

			// The foreign key of each resource of the event is about to be nulled.
			const resources = await tx.resource.findMany({
				where: { eventId: current.id },
				select: { id: true },
			});
			for (const resource of resources) {
				await touch(tx, "resource", { id: resource.id }, {});
			}
			await guardedDelete(tx, "calendarEvent", { id: current.id }, opts);
		},
	});

	return {
		create,
		findOne,
		findMany,
		update,
		upsert,
		delete: remove,
		recomputeTimes,
	};
});

/** The calendar event service, as built by {@link makeCalendarEventService}. */
export type CalendarEventService = ReturnType<typeof makeCalendarEventService>;

//
// Auxiliary functions
//

/// A slot never runs past midnight, so no event lasts longer than a day.
const LONGEST_SLOT_MS = 24 * 60 * 60_000;

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
 * Finds the event a write targets, refusing an actor who may not write to its
 * course.
 *
 * A missing event is a `NotFound`, unless `opts` expects a version: then it is
 * a `PreconditionFailed` carrying `null`.
 */
async function writableEvent(
	tx: PrismaTx,
	filter: CalendarEventPK,
	opts: ServiceOptsWithoutTx,
	action: "calendar-event.update" | "calendar-event.delete",
) {
	const { actor } = opts;
	const found = await tx.calendarEvent.findFirst({
		where: await eventWhere(tx, filter),
		select: {
			id: true,
			courseId: true,
			course: { select: { instructor: { select: { username: true } } } },
		},
	});
	if (!found) checkExpectedUpdatedAt(null, opts.expectedUpdatedAt);
	const event = valueOrNotFound("calendar-event", found);

	if (!hasPerm(actor, "course.update-contents", event.course)) {
		throw new NotAllowed(action);
	}
	return event;
}

/// Reads an event back with everything `fromDb` needs.
function reload(tx: PrismaTx, id: CalendarEventId) {
	return tx.calendarEvent.findUniqueOrThrow({
		where: { id },
		include: EVENT_INCLUDE,
	});
}

/// Replaces the repositories an event cites with those of `slugs`, all of
/// which must belong to the event's course.
async function setRepositories(
	tx: PrismaTx,
	eventId: CalendarEventId,
	courseId: CourseId,
	slugs: readonly string[],
): Promise<void> {
	const unique = [...new Set(slugs)];
	const found = await tx.repository.findMany({
		where: { courseId, slug: { in: unique } },
		select: { id: true, slug: true },
	});
	const known = new Set(found.map((r) => r.slug));
	const unknown = unique.filter((slug) => !known.has(slug));
	if (unknown.length > 0) {
		throw new InvalidData({
			repositories: unknown.map((slug) => ({
				code: "not-exists" as const,
				message: m.errors_repository_event_unknown({ slug }),
			})),
		});
	}

	await tx.calendarEventRepository.deleteMany({ where: { eventId } });
	await tx.calendarEventRepository.createMany({
		data: found.map((r) => ({ eventId, courseId, repositoryId: r.id })),
	});
}

/** Converts a database row into the calendar event entity. */
function fromDb(row: DbEvent): CalendarEvent {
	const { course: _course, timeSlot, repositories, ...rest } = row;
	return {
		...rest,
		repositories: repositories.map((link) => link.repository),
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
