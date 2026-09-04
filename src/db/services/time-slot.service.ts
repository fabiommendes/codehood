/**
 * The weekly pattern half of a course's schedule — see
 * `dev/specs/to-review/calendar.md`. Writes are ownership-gated
 * ({@link canWriteCourseContent}); reads follow course-contents visibility
 * ({@link canViewCourseContents}). A slot is never archived — deleting one
 * with events attached is refused, naming the count.
 */
import type { z } from "zod";
import {
	canViewCourseContents,
	canWriteCourseContent,
	courseContentsVisibility,
} from "@/auth/permissions";
import { NotAllowed } from "@/core/error";
import type { FillUndefineds } from "@/utils/types";
import { Validate } from "@/utils/validate";
import {
	type CourseId,
	type TimeSlotId,
	timeSlotCreate,
	timeSlotFilter,
	timeSlotPK,
	type timeSlotRef,
	timeSlotSchema,
	timeSlotUpdate,
} from "../../core/schemas";
import type { Crud, ServiceOpts } from "../base-service";
import { type Prisma, type PrismaClient, prisma } from "../client";

export type { TimeSlotId } from "../../core/schemas";
export { weekdaySchema } from "../../core/schemas";

//
// Type definitions
//
export type TimeSlotCreate = z.infer<typeof timeSlotCreate>;
export type TimeSlot = z.infer<typeof timeSlotSchema>;
export type TimeSlotFilter = z.infer<typeof timeSlotFilter>;
export type TimeSlotPK = z.infer<typeof timeSlotPK>;
export type TimeSlotUpdate = z.infer<typeof timeSlotUpdate>;
export type TimeSlotRef = z.infer<typeof timeSlotRef>;

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

type DbTimeSlot = Prisma.TimeSlotGetPayload<{
	include: typeof timeSlotInclude;
}>;

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
	Crud<{
		entity: TimeSlot;
		pkFilter: TimeSlotPK;
		create: TimeSlotCreate;
		filter: TimeSlotFilter;
		update: TimeSlotUpdate;
	}> {
	prisma: PrismaClient;

	constructor(client: PrismaClient = prisma) {
		this.prisma = client;
	}

	/**
	 * Creates a time slot.
	 *
	 * Rejects `durationMin <= 0`, a `startMin` outside `0..1439`, a slot
	 * running past midnight, and a second slot in the same course
	 * overlapping an existing one on the same weekday.
	 */
	@Validate({ service: true, returns: timeSlotSchema, args: [timeSlotCreate] })
	async create(input: TimeSlotCreate, opts: ServiceOpts): Promise<TimeSlot> {
		const client = opts.tx ?? this.prisma;
		const course = await client.course.findUnique({
			where: { id: input.courseId },
			select: { instructor: { select: { id: true } } },
		});
		if (!course || !canWriteCourseContent(opts.actor, course)) {
			throw new NotAllowed({ action: "create-time-slot" });
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
		return toTimeSlot(row);
	}

	/**
	 * Finds a slot by id or by its `(courseId, slug)` natural key.
	 *
	 * Throws `FORBIDDEN` if it exists but `actor` may not see its course's
	 * contents; returns `null` if it does not exist.
	 */
	@Validate({
		service: true,
		returns: timeSlotSchema.nullable(),
		args: [timeSlotPK],
	})
	async findOne(
		filter: TimeSlotPK,
		opts: ServiceOpts,
	): Promise<TimeSlot | null> {
		const client = opts.tx ?? this.prisma;
		const by = filter as FillUndefineds<TimeSlotPK>; // zod doesn't narrow to a single field, so we do it here
		let row: DbTimeSlot | null = null;

		if (by.id !== undefined) {
			row = await client.timeSlot.findUnique({
				where: { id: by.id },
				include: timeSlotInclude,
			});
		} else if (by.ref) {
			row = await client.timeSlot.findUnique({
				where: {
					courseId_slug: { courseId: by.ref.courseId, slug: by.ref.slug },
				},
				include: timeSlotInclude,
			});
		}

		if (!row) return null;
		if (!canViewCourseContents(opts.actor, row.course)) {
			throw new NotAllowed({ action: "read-time-slot" });
		}
		return toTimeSlot(row);
	}

	/**
	 * Lists slots narrowed to what `actor` may see (see
	 * {@link courseContentsVisibility}), ordered by weekday then start time
	 * so the syllabus line reads Monday-first.
	 */
	@Validate({
		service: true,
		returns: timeSlotSchema.array(),
		args: [timeSlotFilter],
	})
	async findMany(
		filter: TimeSlotFilter,
		opts: ServiceOpts,
	): Promise<TimeSlot[]> {
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
		return rows.map(toTimeSlot);
	}

	/**
	 * Changes `title`, `day`, `startMin`, or `durationMin`. Never `slug`.
	 *
	 * A slot's existing events keep their own times: moving the hour here
	 * does not move a single row in `CalendarEvent` (see "Week numbers are
	 * authored" in the spec) — the CLI plans that as its own writes.
	 */
	@Validate({
		service: true,
		returns: timeSlotSchema,
		args: [timeSlotPK, timeSlotUpdate],
	})
	async update(
		filter: TimeSlotPK,
		fields: TimeSlotUpdate,
		opts: ServiceOpts,
	): Promise<TimeSlot> {
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("time slot not found");

		const client = opts.tx ?? this.prisma;
		const current = await client.timeSlot.findUnique({
			where: { id: target.id },
			include: timeSlotInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new NotAllowed({ action: "update-time-slot" });
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
			where: { id: target.id },
			data: {
				title: fields.title,
				day: fields.day,
				startMin: fields.startMin,
				durationMin: fields.durationMin,
			},
			include: timeSlotInclude,
		});
		return toTimeSlot(row);
	}

	/**
	 * Deletes a time slot.
	 *
	 * Refuses one that still has events, naming the count — the same
	 * pattern as `editionService.delete` refusing an edition in use.
	 */
	@Validate({ service: true, args: [timeSlotPK] })
	async delete(filter: TimeSlotPK, opts: ServiceOpts): Promise<void> {
		const target = await this.findOne(filter, opts);
		if (!target) throw new Error("time slot not found");

		const client = opts.tx ?? this.prisma;
		const current = await client.timeSlot.findUnique({
			where: { id: target.id },
			include: timeSlotInclude,
		});
		if (!current || !canWriteCourseContent(opts.actor, current.course)) {
			throw new NotAllowed({ action: "delete-time-slot" });
		}
		const eventCount = await client.calendarEvent.count({
			where: { timeSlotId: target.id },
		});
		if (eventCount > 0) {
			throw new Error(
				`Slot "${current.slug}" still has ${eventCount} event(s) and cannot be deleted.`,
			);
		}
		await client.timeSlot.delete({ where: { id: target.id } });
	}
}

export const timeSlotService = new TimeSlotService();

//
// Auxiliary functions
//

// Convert a database time slot record to the public-facing time slot type.
function toTimeSlot(row: DbTimeSlot): TimeSlot {
	const { course: _course, ...rest } = row;
	return {
		...rest,
		id: rest.id as TimeSlotId,
		courseId: rest.courseId as CourseId,
	};
}
