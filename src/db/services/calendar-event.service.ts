/**
 * The dated half of a course's schedule — see
 * `dev/specs/to-review/calendar.md`. Writes are ownership-gated
 * ({@link canWriteCourseContent}); reads follow course-contents visibility
 * ({@link canViewCourseContents}). `examId` is never authored: both `create`
 * and `update` resolve it fresh from {@link examForEvent} on every write.
 */
import type { z } from "zod";
import {
	canViewCourseContents,
	canWriteCourseContent,
	courseContentsVisibility,
} from "@/auth/permissions";
import type { Actor } from "@/core/actor";
import { NotAllowed } from "@/core/error";
import {
	endOf,
	localDateOf,
	toInstant,
	weekdayOf,
} from "@/utils/schedule-time";
import type { FillUndefineds } from "@/utils/types";
import { Validate } from "@/utils/validate";
import {
	type CalendarEventId,
	type CourseId,
	calendarEventCreate,
	calendarEventFilter,
	calendarEventPK,
	calendarEventSchema,
	calendarEventUpdate,
	type TimeSlotId,
} from "../../core/schemas";
import type { Crud, ServiceOpts } from "../base-service";
import {
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
	type Weekday,
} from "../client";
import { examForEvent } from "../util.exam-link";

export type { CalendarEventId } from "../../core/schemas";

//
// Type definitions
//
export type CalendarEventCreate = z.infer<typeof calendarEventCreate>;
export type CalendarEvent = z.infer<typeof calendarEventSchema>;
export type CalendarEventFilter = z.infer<typeof calendarEventFilter>;
export type CalendarEventPK = z.infer<typeof calendarEventPK>;
export type CalendarEventUpdate = z.infer<typeof calendarEventUpdate>;
export type EventKind = CalendarEvent["kind"];
export type LinkedExam = NonNullable<CalendarEvent["exam"]>;

/** True for the seven kinds that represent an actual meeting (FR-CAL-011). */
const MEETING_KINDS: ReadonlySet<EventKind> = new Set([
	"LECTURE",
	"LAB",
	"EXAM",
	"REVIEW",
	"SEMINAR",
	"PROJECT",
	"SELF_STUDY",
]);

/** The minimal shape every read loads: the owning course, the slot, and the linked exam. */
const EVENT_INCLUDE = {
	course: {
		select: {
			instructor: { select: { id: true } },
			enrollments: {
				where: { status: "ACTIVE" as const },
				select: { userId: true },
			},
		},
	},
	timeSlot: true,
	exam: { select: { id: true, slug: true, title: true, status: true } },
} satisfies Prisma.CalendarEventInclude;

type DbEvent = Prisma.CalendarEventGetPayload<{
	include: typeof EVENT_INCLUDE;
}>;

class CalendarEventService
	implements
		Crud<{
			entity: CalendarEvent;
			pkFilter: CalendarEventPK;
			create: CalendarEventCreate;
			filter: CalendarEventFilter;
			update: CalendarEventUpdate;
		}>
{
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Given only a day, fills `startAt` and `durationMin` from the slot;
	 * explicit `startMin`/`durationMin` are kept as given.
	 *
	 * Rejects a slot belonging to another course, an event whose resolved
	 * `startAt` falls on a different weekday than its slot, and a second
	 * event on the same slot on the same local day.
	 */
	@Validate({
		service: true,
		returns: calendarEventSchema,
		args: [calendarEventCreate],
	})
	async create(
		input: CalendarEventCreate,
		opts: ServiceOpts,
	): Promise<CalendarEvent> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			select: { instructor: { select: { id: true } } },
		});
		if (!course || !canWriteCourseContent(opts.actor, course)) {
			throw new NotAllowed({ action: "create-calendar-event" });
		}

		const slot = await client.timeSlot.findUnique({
			where: { id: input.timeSlotId },
		});
		if (!slot || slot.courseId !== input.courseId) {
			throw new Error(
				`Time slot ${input.timeSlotId} does not belong to course ${input.courseId}.`,
			);
		}

		const startMin = input.startMin ?? slot.startMin;
		const durationMin = input.durationMin ?? slot.durationMin;
		const startAt = toInstant(input.date, startMin);
		assertWeekdayMatches(startAt, slot.day, slot.slug);
		await assertNoSlotDayCollision(client, slot.id, startAt, null);

		const examId = await examForEvent(client, {
			courseId: input.courseId,
			startAt,
			durationMin,
		});

		const row = await client.calendarEvent.create({
			data: {
				courseId: input.courseId,
				timeSlotId: input.timeSlotId,
				slug: input.slug,
				startAt,
				durationMin,
				week: input.week,
				kind: input.kind,
				title: input.title,
				description: input.description,
				examId,
				contentHash: input.contentHash,
			},
			include: EVENT_INCLUDE,
		});
		return maskExam(row, opts.actor);
	}

	/**
	 * Finds an event by id or by its `(courseId, slug)` natural key.
	 *
	 * Throws `FORBIDDEN` if it exists but `actor` may not see its course's
	 * contents; returns `null` if it does not exist.
	 */
	@Validate({
		service: true,
		returns: calendarEventSchema.nullable(),
		args: [calendarEventPK],
	})
	async findOne(
		filter: CalendarEventPK,
		opts: ServiceOpts,
	): Promise<CalendarEvent | null> {
		const client = opts.tx ?? this.prisma;
		const by = filter as FillUndefineds<CalendarEventPK>; // zod doesn't narrow to a single field, so we do it here
		let row: DbEvent | null = null;

		if (by.id !== undefined) {
			row = await client.calendarEvent.findUnique({
				where: { id: by.id },
				include: EVENT_INCLUDE,
			});
		} else if (by.ref) {
			row = await client.calendarEvent.findUnique({
				where: {
					courseId_slug: { courseId: by.ref.courseId, slug: by.ref.slug },
				},
				include: EVENT_INCLUDE,
			});
		}

		if (!row) return null;
		if (!canViewCourseContents(opts.actor, row.course)) {
			throw new NotAllowed({ action: "read-calendar-event" });
		}
		return maskExam(row, opts.actor);
	}

	/**
	 * Lists events narrowed to what `actor` may see (see
	 * {@link courseContentsVisibility}).
	 *
	 * With no `courseIds`, returns everything the actor may see — what
	 * `/calendar` wants. `from` is inclusive of an event still running at
	 * that instant, applied after the database query since it depends on
	 * `durationMin`; every other filter is a plain `where`. Ordered by
	 * `startAt`.
	 */
	@Validate({
		service: true,
		returns: calendarEventSchema.array(),
		args: [calendarEventFilter],
	})
	async findMany(
		filter: CalendarEventFilter,
		opts: ServiceOpts,
	): Promise<CalendarEvent[]> {
		const client = opts.tx ?? this.prisma;
		const rows = await client.calendarEvent.findMany({
			where: {
				AND: [
					filter.courseIds ? { courseId: { in: filter.courseIds } } : {},
					filter.kinds ? { kind: { in: filter.kinds } } : {},
					filter.weeks ? { week: { in: filter.weeks } } : {},
					filter.to !== undefined ? { startAt: { lt: filter.to } } : {},
					{ course: courseContentsVisibility(opts.actor) },
				],
			},
			include: EVENT_INCLUDE,
			orderBy: { startAt: "asc" },
		});

		const from = filter.from;
		const inWindow =
			from !== undefined
				? rows.filter((r) => endOf(r.startAt, r.durationMin) >= from)
				: rows;
		const limited =
			filter.limit !== undefined ? inWindow.slice(0, filter.limit) : inWindow;
		return limited.map((r) => maskExam(r, opts.actor));
	}

	/**
	 * Changes `week`/`kind`/`title`/`description`/`contentHash` freely, and
	 * the event's time when `date` is given.
	 *
	 * `startMin`/`durationMin` combine with `date`, each defaulting to the
	 * slot's own when omitted from a `date` move, or to the current value
	 * when only `durationMin` changes alone. Re-runs the weekday and
	 * same-day-collision checks whenever the date moves, and always
	 * re-resolves `examId` from the (possibly unchanged) window.
	 */
	@Validate({
		service: true,
		returns: calendarEventSchema,
		args: [calendarEventPK, calendarEventUpdate],
	})
	async update(
		filter: CalendarEventPK,
		fields: CalendarEventUpdate,
		opts: ServiceOpts,
	): Promise<CalendarEvent> {
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("event not found");

		const client = opts.tx ?? this.prisma;
		const current = await client.calendarEvent.findUnique({
			where: { id: target.id },
			include: EVENT_INCLUDE,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new NotAllowed({ action: "update-calendar-event" });
		}

		let startAt = current.startAt;
		let durationMin = fields.durationMin ?? current.durationMin;

		if (fields.date !== undefined) {
			const slot = await client.timeSlot.findUnique({
				where: { id: current.timeSlotId },
			});
			if (!slot) {
				throw new Error(
					`Event ${current.id} has no time slot ${current.timeSlotId}.`,
				);
			}
			const startMin = fields.startMin ?? slot.startMin;
			durationMin = fields.durationMin ?? slot.durationMin;
			startAt = toInstant(fields.date, startMin);
			assertWeekdayMatches(startAt, slot.day, slot.slug);
			await assertNoSlotDayCollision(client, slot.id, startAt, current.id);
		} else if (fields.startMin !== undefined) {
			throw new Error("Changing startMin also requires date.");
		}

		const examId = await examForEvent(client, {
			courseId: current.courseId,
			startAt,
			durationMin,
		});

		const row = await client.calendarEvent.update({
			where: { id: target.id },
			data: {
				startAt,
				durationMin,
				week: fields.week,
				kind: fields.kind,
				title: fields.title,
				description: fields.description,
				contentHash: fields.contentHash,
				examId,
			},
			include: EVENT_INCLUDE,
		});
		return maskExam(row, opts.actor);
	}

	/**
	 * Removes the row outright — events are never archived (FR-CAL-014).
	 *
	 * A subsequent `findOne` returns `null`.
	 */
	@Validate({ service: true, args: [calendarEventPK] })
	async delete(filter: CalendarEventPK, opts: ServiceOpts): Promise<void> {
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("event not found");

		const client = opts.tx ?? this.prisma;
		const current = await client.calendarEvent.findUnique({
			where: { id: target.id },
			include: EVENT_INCLUDE,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new NotAllowed({ action: "delete-calendar-event" });
		}
		await client.calendarEvent.delete({ where: { id: target.id } });
	}
}

export const calendarEventService = new CalendarEventService();

//
// Auxiliary functions
//

/** Rejects an event whose resolved `startAt` lands on a day other than its slot's. */
function assertWeekdayMatches(
	startAt: Date,
	slotDay: Weekday,
	slotSlug: string,
): void {
	const actual = weekdayOf(startAt);
	if (actual !== slotDay) {
		throw new Error(
			`This event falls on ${actual}, but its slot "${slotSlug}" is on ${slotDay}.`,
		);
	}
}

/**
 * There is no `@@unique([timeSlotId, date])` — SQLite cannot express it over
 * a stored instant — so this range query over the event's local day carries
 * "one meeting per slot per day" instead.
 */
async function assertNoSlotDayCollision(
	client: PrismaClient | PrismaTx,
	timeSlotId: number,
	startAt: Date,
	excludeEventId: number | null,
): Promise<void> {
	const dayStartMin = toInstant(localDateOf(startAt), 0);
	const dayEndMin = toInstant(localDateOf(startAt), 1440);
	const siblings = await client.calendarEvent.findMany({
		where: {
			timeSlotId,
			startAt: { gte: dayStartMin, lt: dayEndMin },
			...(excludeEventId !== null ? { NOT: { id: excludeEventId } } : {}),
		},
		select: { id: true },
	});
	if (siblings.length > 0) {
		throw new Error(
			`This slot already has an event on ${localDateOf(startAt)}.`,
		);
	}
}

/**
 * The link is computed for everybody — it is a fact about the schedule —
 * but a row must not leak the existence and title of an unpublished exam to
 * anyone but the course's own instructor (or `SYSTEM`): `DRAFT` and
 * `ARCHIVED` exams are nulled out of what non-owners see.
 */
function maskExam(row: DbEvent, actor: Actor): CalendarEvent {
	const { course, exam, ...rest } = row;
	const privileged = canWriteCourseContent(actor, course);
	const visible =
		exam !== null &&
		(privileged || (exam.status !== "DRAFT" && exam.status !== "ARCHIVED"));
	return {
		...rest,
		id: rest.id as CalendarEventId,
		courseId: rest.courseId as CourseId,
		timeSlotId: rest.timeSlotId as TimeSlotId,
		timeSlot: {
			...rest.timeSlot,
			id: rest.timeSlot.id as TimeSlotId,
			courseId: rest.timeSlot.courseId as CourseId,
		},
		exam:
			visible && exam
				? { id: exam.id, slug: exam.slug, title: exam.title }
				: null,
	};
}

/** Whether `kind` represents a meeting that was actually held. */
export function isMeeting(kind: EventKind): boolean {
	return MEETING_KINDS.has(kind);
}
