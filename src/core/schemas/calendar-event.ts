import { z } from "zod";
import { calendarEventId, courseId, examId, timeSlotId } from "./base";
import { timeSlotSchema } from "./time-slot";

export const eventKindSchema = z.enum([
	"LECTURE",
	"LAB",
	"EXAM",
	"REVIEW",
	"SEMINAR",
	"PROJECT",
	"SELF_STUDY",
	"HOLIDAY",
	"RECESS",
	"CANCELLED",
]);

// The linked exam's public summary — never the full `Exam` row, and never
// present at all unless {@link maskExam} decides `actor` may see it.
export const linkedExamSchema = z.object({
	id: examId,
	slug: z.string(),
	title: z.string(),
});

export const calendarEventSchema = z.object({
	id: calendarEventId,
	courseId: courseId,
	timeSlotId: timeSlotId,
	examId: examId.nullable(),
	exam: linkedExamSchema.nullable(),

	// Natural key from the repository path — FR-SYNC-010.
	slug: z.string().min(1),
	startAt: z.date(),
	durationMin: z.number().int(),
	week: z.number().int(),

	kind: eventKindSchema,
	title: z.string().min(1),
	description: z.string().nullable(),

	// Supplied by the writer, opaque to the server.
	contentHash: z.string().min(1),
	createdAt: z.date(),
	updatedAt: z.date(),

	timeSlot: timeSlotSchema,
});

export const calendarEventCreate = calendarEventSchema
	.omit({
		id: true,
		createdAt: true,
		updatedAt: true,
		exam: true,
		// Computed by the service
		startAt: true,
		examId: true,
		timeSlot: true,
	})
	.extend({
		// The calendar day this event happens, `YYYY-MM-DD`, in the server zone.
		date: z.string(),
		// Minutes since 00:00; defaults to the slot's `startMin` when omitted.
		startMin: z.number().int().optional(),
		// Defaults to the slot's `durationMin` when omitted.
		durationMin: z.number().int().optional(),
		// Defaults to the Prisma column default (`LECTURE`) when omitted.
		kind: eventKindSchema.optional(),
		description: z.string().nullable().optional(),
	});

// `slug`, `courseId`, and `timeSlotId` are deliberately absent: moving an
// event to a different slot is a delete plus a create. Provide `date` to
// move the event's day; `startMin`/`durationMin` without `date` is rejected,
// since a wall-clock move always names the day it lands on.
export const calendarEventUpdate = z.object({
	date: z.string().optional(),
	startMin: z.number().int().optional(),
	durationMin: z.number().int().optional(),
	week: z.number().int().optional(),
	kind: eventKindSchema.optional(),
	title: z.string().optional(),
	description: z.string().nullish(),
	contentHash: z.string().optional(),
});

export const calendarEventUpsert = calendarEventCreate;

export const calendarEventRef = z.object({
	courseId: courseId,
	slug: z.string(),
});

export const calendarEventPK = z.union([
	z.object({ id: calendarEventId }),
	z.object({ ref: calendarEventRef }),
]);

export const calendarEventFilter = z.object({
	courseIds: z.array(z.number()).optional(),
	// Inclusive: events whose window ends at or after it.
	from: z.date().optional(),
	// Exclusive: events starting before it.
	to: z.date().optional(),
	kinds: z.array(eventKindSchema).optional(),
	weeks: z.array(z.number().int()).optional(),
	// For "the next three meetings" on the course page.
	limit: z.number().int().positive().optional(),
});
