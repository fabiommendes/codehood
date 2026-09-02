/**
 * The weekly pattern half of a course's schedule — see
 * `dev/specs/to-review/calendar.md`. Writes are ownership-gated
 * ({@link canWriteCourseContent}); reads follow course-contents visibility
 * ({@link canViewCourseContents}). A slot is never archived — deleting one
 * with events attached is refused, naming the count.
 */
import {
	canViewCourseContents,
	canWriteCourseContent,
	courseContentsVisibility,
} from "@/auth/permissions";
import type { FillUndefineds } from "@/utils/types";
import {
	type Create,
	type Delete,
	type FindMany,
	type FindOne,
	ForbiddenError,
	type ServiceOpts,
	type Update,
} from "./base-service";
import { type Prisma, type PrismaClient, prisma, type Weekday } from "./client";

export interface CreateTimeSlot {
	courseId: number;
	/** Authored, sync identity. Stable when the hour changes. */
	slug: string;
	/** Optional label for the syllabus line: "Lecture", "Lab". */
	title?: string;
	day: Weekday;
	/** Minutes since 00:00 in the server zone, e.g. 14:30 -> 870. */
	startMin: number;
	durationMin: number;
}

export type TimeSlotRef = { courseId: number; slug: string };

export type FindTimeSlotBy = FillUndefineds<
	{ id: number } | { ref: TimeSlotRef }
>;

export interface FindTimeSlotsBy {
	courseId?: number;
}

export interface UpdateTimeSlotFilter {
	id: number;
}

/**
 * The editable fields. `slug` is deliberately absent — it is the sync natural
 * key, and changing it is a delete plus a create (FR-SYNC-011).
 */
export interface UpdateTimeSlot {
	title?: string | null;
	day?: Weekday;
	startMin?: number;
	durationMin?: number;
}

export interface DeleteTimeSlotFilter {
	id: number;
}

/** The minimal course shape the write/read predicates need, loaded alongside every row. */
const timeSlotInclude = {
	course: {
		select: {
			instructor: { select: { id: true } },
			enrollments: {
				where: { status: "ACTIVE" as const },
				select: { userId: true },
			},
		},
	},
} satisfies Prisma.TimeSlotInclude;

type TimeSlotRow = Prisma.TimeSlotGetPayload<{
	include: typeof timeSlotInclude;
}>;

export type TimeSlotWithDetails = Omit<TimeSlotRow, "course">;

function omitCourse(row: TimeSlotRow): TimeSlotWithDetails {
	const { course: _course, ...rest } = row;
	return rest;
}

/** `durationMin > 0`, `startMin` in range, and the slot does not run past midnight. */
function validateWindow(startMin: number, durationMin: number): void {
	if (durationMin <= 0) {
		throw new Error("A time slot's durationMin must be greater than zero.");
	}
	if (startMin < 0 || startMin > 1439) {
		throw new Error("A time slot's startMin must be within 0..1439.");
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

class TimeSlotService
	implements
	Create<CreateTimeSlot, TimeSlotWithDetails>,
	FindOne<FindTimeSlotBy, TimeSlotWithDetails>,
	FindMany<FindTimeSlotsBy, TimeSlotWithDetails>,
	Update<UpdateTimeSlotFilter, UpdateTimeSlot, TimeSlotWithDetails>,
	Delete<DeleteTimeSlotFilter> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Rejects `durationMin <= 0`, a `startMin` outside `0..1439`, a slot
	 * running past midnight, and a second slot in the same course overlapping
	 * an existing one on the same weekday.
	 */
	async create(
		input: CreateTimeSlot,
		opts: ServiceOpts,
	): Promise<TimeSlotWithDetails> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			select: { instructor: { select: { id: true } } },
		});
		if (!course || !canWriteCourseContent(opts.actor, course)) {
			throw new ForbiddenError();
		}
		validateWindow(input.startMin, input.durationMin);

		const siblings = await client.timeSlot.findMany({
			where: { courseId: input.courseId, day: input.day },
			select: { id: true, slug: true, startMin: true, durationMin: true },
		});
		const collision = siblings.find((s) =>
			minutesOverlap(
				input.startMin,
				input.durationMin,
				s.startMin,
				s.durationMin,
			),
		);
		if (collision) {
			throw new Error(
				`This slot overlaps slot "${collision.slug}" on ${input.day}.`,
			);
		}

		const row = await client.timeSlot.create({
			data: {
				courseId: input.courseId,
				slug: input.slug,
				title: input.title,
				day: input.day,
				startMin: input.startMin,
				durationMin: input.durationMin,
			},
			include: timeSlotInclude,
		});
		return omitCourse(row);
	}

	/**
	 * Finds a slot by id or by its `(courseId, slug)` natural key. Throws
	 * `FORBIDDEN` if it exists but `actor` may not see its course's contents;
	 * returns `null` if it does not exist.
	 */
	async findOne(
		filter: FindTimeSlotBy,
		opts: ServiceOpts,
	): Promise<TimeSlotWithDetails | null> {
		const client = opts.tx ?? this.prisma;
		let row: TimeSlotRow | null = null;

		if (filter.id !== undefined) {
			row = await client.timeSlot.findUnique({
				where: { id: filter.id },
				include: timeSlotInclude,
			});
		} else if (filter.ref) {
			row = await client.timeSlot.findUnique({
				where: {
					courseId_slug: {
						courseId: filter.ref.courseId,
						slug: filter.ref.slug,
					},
				},
				include: timeSlotInclude,
			});
		}

		if (!row) return null;
		if (!canViewCourseContents(opts.actor, row.course)) {
			throw new ForbiddenError();
		}
		return omitCourse(row);
	}

	/**
	 * Lists slots narrowed to what `actor` may see (see
	 * {@link courseContentsVisibility}), ordered by weekday then start time so
	 * the syllabus line reads Monday-first.
	 */
	async findMany(
		filter: FindTimeSlotsBy,
		opts: ServiceOpts,
	): Promise<TimeSlotWithDetails[]> {
		const client = opts.tx ?? this.prisma;
		const rows = await client.timeSlot.findMany({
			where: {
				AND: [
					filter.courseId !== undefined ? { courseId: filter.courseId } : {},
					{ course: courseContentsVisibility(opts.actor) },
				],
			},
			include: timeSlotInclude,
			orderBy: [{ day: "asc" }, { startMin: "asc" }],
		});
		return rows.map(omitCourse);
	}

	/**
	 * Changes `title`, `day`, `startMin`, or `durationMin`. Never `slug` — see
	 * {@link UpdateTimeSlot}. A slot's existing events keep their own times:
	 * moving the hour here does not move a single row in `CalendarEvent`
	 * (see "Week numbers are authored" in the spec) — the CLI plans that as
	 * its own writes.
	 */
	async update(
		filter: UpdateTimeSlotFilter,
		fields: UpdateTimeSlot,
		opts: ServiceOpts,
	): Promise<TimeSlotWithDetails> {
		const client = opts.tx ?? this.prisma;
		const current = await client.timeSlot.findUnique({
			where: { id: filter.id },
			include: timeSlotInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new ForbiddenError();
		}

		const day = fields.day ?? current.day;
		const startMin = fields.startMin ?? current.startMin;
		const durationMin = fields.durationMin ?? current.durationMin;
		validateWindow(startMin, durationMin);

		const siblings = await client.timeSlot.findMany({
			where: { courseId: current.courseId, day, NOT: { id: current.id } },
			select: { id: true, slug: true, startMin: true, durationMin: true },
		});
		const collision = siblings.find((s) =>
			minutesOverlap(startMin, durationMin, s.startMin, s.durationMin),
		);
		if (collision) {
			throw new Error(`This slot overlaps slot "${collision.slug}" on ${day}.`);
		}

		const row = await client.timeSlot.update({
			where: { id: filter.id },
			data: {
				title: fields.title,
				day: fields.day,
				startMin: fields.startMin,
				durationMin: fields.durationMin,
			},
			include: timeSlotInclude,
		});
		return omitCourse(row);
	}

	/**
	 * Refuses a slot that still has events, naming the count — the same
	 * pattern as `editionService.delete` refusing an edition in use.
	 */
	async delete(filter: DeleteTimeSlotFilter, opts: ServiceOpts): Promise<void> {
		const client = opts.tx ?? this.prisma;
		const current = await client.timeSlot.findUnique({
			where: { id: filter.id },
			include: timeSlotInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new ForbiddenError();
		}
		const eventCount = await client.calendarEvent.count({
			where: { timeSlotId: filter.id },
		});
		if (eventCount > 0) {
			throw new Error(
				`Slot "${current.slug}" still has ${eventCount} event(s) and cannot be deleted.`,
			);
		}
		await client.timeSlot.delete({ where: { id: filter.id } });
	}
}

export const timeSlotService = new TimeSlotService();
export type { Weekday };
