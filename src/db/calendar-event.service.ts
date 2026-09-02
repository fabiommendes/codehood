/**
 * The dated half of a course's schedule — see
 * `dev/specs/to-review/calendar.md`. Writes are ownership-gated
 * ({@link canWriteCourseContent}); reads follow course-contents visibility
 * ({@link canViewCourseContents}). `examId` is never authored: both `create`
 * and `update` resolve it fresh from {@link examForEvent} on every write.
 */
import {
	canViewCourseContents,
	canWriteCourseContent,
	courseContentsVisibility,
} from "@/auth/permissions";
import {
	endOf,
	localDateOf,
	toInstant,
	weekdayOf,
} from "@/utils/schedule-time";
import type { FillUndefineds } from "@/utils/types";
import {
	type Actor,
	type Create,
	type Delete,
	type FindMany,
	type FindOne,
	ForbiddenError,
	type ServiceOpts,
	type Update,
} from "./base-service";
import {
	type EventKind,
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
	type Weekday,
} from "./client";
import { examForEvent } from "./exam-link";

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

/** Whether `kind` represents a meeting that was actually held. */
export function isMeeting(kind: EventKind): boolean {
	return MEETING_KINDS.has(kind);
}

export interface CreateEvent {
	courseId: number;
	timeSlotId: number;
	/** Natural key from the repository path — FR-SYNC-010. */
	slug: string;
	/** The calendar day this event happens, `YYYY-MM-DD`, in the server zone. */
	date: string;
	/** Minutes since 00:00; defaults to the slot's `startMin` when omitted. */
	startMin?: number;
	/** Defaults to the slot's `durationMin` when omitted. */
	durationMin?: number;
	/** Authored, never derived (FR-CAL-015). */
	week: number;
	kind?: EventKind;
	title: string;
	description?: string;
	/** Supplied by the writer, stored verbatim. */
	contentHash: string;
}

export type EventRef = { courseId: number; slug: string };

export type FindEventBy = FillUndefineds<{ id: number } | { ref: EventRef }>;

export interface FindEventsBy {
	courseIds?: number[];
	/** Inclusive: events whose window ends at or after it. */
	from?: Date;
	/** Exclusive: events starting before it. */
	to?: Date;
	kinds?: EventKind[];
	weeks?: number[];
	/** For "the next three meetings" on the course page. */
	limit?: number;
}

export interface UpdateEventFilter {
	id: number;
}

/**
 * The editable fields. `slug`, `courseId`, and `timeSlotId` are absent —
 * moving an event to a different slot is a delete plus a create. Provide
 * `date` to move the event's day; `startMin`/`durationMin` without `date` is
 * rejected, since a wall-clock move always names the day it lands on.
 */
export interface UpdateEvent {
	date?: string;
	startMin?: number;
	durationMin?: number;
	week?: number;
	kind?: EventKind;
	title?: string;
	description?: string;
	contentHash?: string;
}

export interface DeleteEventFilter {
	id: number;
}

/** The minimal shape every read loads: the owning course, the slot, and the linked exam. */
const eventInclude = {
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

type EventRow = Prisma.CalendarEventGetPayload<{
	include: typeof eventInclude;
}>;

/** The linked exam's public summary, or `null` — see {@link maskExam}. */
export type LinkedExam = { id: number; slug: string; title: string };

export type CalendarEventWithDetails = Omit<EventRow, "course" | "exam"> & {
	exam: LinkedExam | null;
};

/**
 * The link is computed for everybody — it is a fact about the schedule — but
 * a row must not leak the existence and title of an unpublished exam to
 * anyone but the course's own instructor (or `SYSTEM`): `DRAFT` and
 * `ARCHIVED` exams are nulled out of what non-owners see.
 */
function maskExam(row: EventRow, actor: Actor): CalendarEventWithDetails {
	const { course: _course, exam, ...rest } = row;
	const privileged = canWriteCourseContent(actor, row.course);
	const visible =
		exam !== null &&
		(privileged || (exam.status !== "DRAFT" && exam.status !== "ARCHIVED"));
	return {
		...rest,
		exam:
			visible && exam
				? { id: exam.id, slug: exam.slug, title: exam.title }
				: null,
	};
}

class CalendarEventService
	implements
	Create<CreateEvent, CalendarEventWithDetails>,
	FindOne<FindEventBy, CalendarEventWithDetails>,
	FindMany<FindEventsBy, CalendarEventWithDetails>,
	Update<UpdateEventFilter, UpdateEvent, CalendarEventWithDetails>,
	Delete<DeleteEventFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Given only a day, fills `startAt` and `durationMin` from the slot;
	 * explicit `startMin`/`durationMin` are kept as given. Rejects a slot
	 * belonging to another course, an event whose resolved `startAt` falls on
	 * a different weekday than its slot, a second event on the same slot on
	 * the same local day, and a missing `contentHash`.
	 */
	async create(
		input: CreateEvent,
		opts: ServiceOpts,
	): Promise<CalendarEventWithDetails> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			select: { instructor: { select: { id: true } } },
		});
		if (!course || !canWriteCourseContent(opts.actor, course)) {
			throw new ForbiddenError();
		}
		if (!input.contentHash) {
			throw new Error("contentHash is required.");
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
			include: eventInclude,
		});
		return maskExam(row, opts.actor);
	}

	/**
	 * Finds an event by id or by its `(courseId, slug)` natural key. Throws
	 * `FORBIDDEN` if it exists but `actor` may not see its course's contents;
	 * returns `null` if it does not exist.
	 */
	async findOne(
		filter: FindEventBy,
		opts: ServiceOpts,
	): Promise<CalendarEventWithDetails | null> {
		const client = opts.tx ?? this.prisma;
		let row: EventRow | null = null;

		if (filter.id !== undefined) {
			row = await client.calendarEvent.findUnique({
				where: { id: filter.id },
				include: eventInclude,
			});
		} else if (filter.ref) {
			row = await client.calendarEvent.findUnique({
				where: {
					courseId_slug: {
						courseId: filter.ref.courseId,
						slug: filter.ref.slug,
					},
				},
				include: eventInclude,
			});
		}

		if (!row) return null;
		if (!canViewCourseContents(opts.actor, row.course)) {
			throw new ForbiddenError();
		}
		return maskExam(row, opts.actor);
	}

	/**
	 * Lists events narrowed to what `actor` may see (see
	 * {@link courseContentsVisibility}). With no `courseIds`, returns
	 * everything the actor may see — what `/calendar` wants. `from` is
	 * inclusive of an event still running at that instant, applied after the
	 * database query since it depends on `durationMin`; every other filter is
	 * a plain `where`. Ordered by `startAt`.
	 */
	async findMany(
		filter: FindEventsBy,
		opts: ServiceOpts,
	): Promise<CalendarEventWithDetails[]> {
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
			include: eventInclude,
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
	 * Changes `week`/`kind`/`title`/`description`/`contentHash` freely, and the
	 * event's time when `date` is given (`startMin`/`durationMin` combine with
	 * it, each defaulting to the slot's own when omitted from a `date` move,
	 * or to the current value when only `durationMin` changes alone). Re-runs
	 * the weekday and same-day-collision checks whenever the date moves, and
	 * always re-resolves `examId` from the (possibly unchanged) window.
	 */
	async update(
		filter: UpdateEventFilter,
		fields: UpdateEvent,
		opts: ServiceOpts,
	): Promise<CalendarEventWithDetails> {
		const client = opts.tx ?? this.prisma;
		const current = await client.calendarEvent.findUnique({
			where: { id: filter.id },
			include: eventInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new ForbiddenError();
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
			where: { id: filter.id },
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
			include: eventInclude,
		});
		return maskExam(row, opts.actor);
	}

	/**
	 * Removes the row outright — events are never archived (FR-CAL-014). A
	 * subsequent `findOne` returns `null`.
	 */
	async delete(filter: DeleteEventFilter, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const current = await client.calendarEvent.findUnique({
			where: { id: filter.id },
			include: eventInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new ForbiddenError();
		}
		await client.calendarEvent.delete({ where: { id: filter.id } });
	}
}

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

export const calendarEventService = new CalendarEventService();
