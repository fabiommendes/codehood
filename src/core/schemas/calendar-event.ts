import { z } from "zod";
import { calendarEventId, courseId, rev, slug, timeSlotId } from "./base";
import { courseRef } from "./course";
import { timeSlotSchema } from "./time-slot";

export const eventKindSchema = z.enum(["REGULAR", "HOLIDAY", "CANCELLED"]);

export const calendarEventSchema = z.object({
	id: calendarEventId,
	courseId: courseId,
	kind: eventKindSchema,
	title: z.string().min(1),
	description: z.string().nullable(),

	/// The exact start time of the event. Declares timezone of the server.
	startAt: z.date(),

	/// Week relative to the start of the course, counting from zero. Weeks
	/// start on Monday (ISO 8601).
	week: z.number().int(),

	/// Time slot information (local time of the course).
	timeSlot: timeSlotSchema.pick({
		id: true,
		day: true,
		slug: true,
		duration: true,
		start: true,
	}),

	rev: rev.nullable(),

	createdAt: z.date(),
	updatedAt: z.date(),
});

export const calendarEventCreate = calendarEventSchema
	.omit({
		id: true,
		courseId: true,
		createdAt: true,
		updatedAt: true,
		startAt: true,
		timeSlot: true,
	})
	.extend({
		// Defaults to the Prisma column default (`REGULAR`) when omitted.
		kind: eventKindSchema.optional(),
		course: courseRef,
		timeSlot: z.union([timeSlotId, slug]),
		description: z.string().nullable().optional(),
		rev: rev.nullish(),
	});

// `week`, `course`, and `timeSlot` are deliberately absent: moving an
// event to a different slot is a delete plus a create.
export const calendarEventUpdate = calendarEventCreate
	.omit({ course: true, timeSlot: true, week: true })
	.partial();

/// The create body of an API already scoped to a course: the course comes
/// from the path, and the slot is addressed the same way the URL addresses
/// it. The service still takes either form.
export const calendarEventCreateScoped = calendarEventCreate
	.omit({ course: true })
	.extend({ timeSlot: slug });

export const calendarEventPK = z.union([
	z.object({ id: calendarEventId }),
	z.object({
		course: courseRef,
		week: z.number().int(),
		timeSlot: z.union([timeSlotId, slug]),
	}),
]);

export const calendarEventFilterBase = z.object({
	// Inclusive: events whose window ends at or after it.
	from: z.date().optional(),
	// Exclusive: events starting before it.
	to: z.date().optional(),
	kinds: z.array(eventKindSchema).optional(),
	weeks: z.array(z.number().int()).optional(),
	// For "the next three meetings" on the course page.
	limit: z.number().int().positive().optional(),
});

export const calendarEventFilterByCourse = calendarEventFilterBase.extend({
	course: courseRef,
});

/// Without any course, the listing spans every course the actor may read,
/// which is what `/calendar` wants.
export const calendarEventFilterByCourseIds = calendarEventFilterBase.extend({
	courseIds: z.array(z.number()).optional(),
});

// The single-course form comes first: `course` is required, so it only
// matches a filter that actually carries it, while every field of the
// `courseIds` form is optional and would otherwise swallow it.
export const calendarEventFilter = z.union([
	calendarEventFilterByCourse,
	calendarEventFilterByCourseIds,
]);
