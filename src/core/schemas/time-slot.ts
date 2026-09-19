import { z } from "zod";
import { courseId, timeSlotId } from "./base";

export const timeSlotSchema = z.object({
	id: timeSlotId,
	courseId: courseId,
	// Authored, sync identity. Stable when the hour changes.
	slug: z.string().min(1),
	title: z.string().nullable(),
	day: z.lazy(() => weekdaySchema),
	// Minutes since 00:00 in the server zone, e.g. 14:30 -> 870.
	startMin: z.number().int(),
	durationMin: z.number().int(),
	createdAt: z.date(),
	updatedAt: z.date(),
});

export const weekdaySchema = z.enum([
	"SUNDAY",
	"MONDAY",
	"TUESDAY",
	"WEDNESDAY",
	"THURSDAY",
	"FRIDAY",
	"SATURDAY",
]);

export const timeSlotCreate = z.object({
	courseId: courseId,
	slug: z.string().min(1),
	title: z.string().nullish(),
	day: weekdaySchema,
	startMin: z.number().int(),
	durationMin: z.number().int(),
});

// `slug` is deliberately absent: it is the sync natural key, and changing it
// is a delete plus a create (FR-SYNC-011).
export const timeSlotUpdate = z.object({
	title: z.string().nullable().optional(),
	day: weekdaySchema.optional(),
	startMin: z.number().int().optional(),
	durationMin: z.number().int().optional(),
});

export const timeSlotUpsert = timeSlotCreate;

export const timeSlotRef = z.object({
	courseId: z.number(),
	slug: z.string(),
});

export const timeSlotPK = z.union([
	z.object({ id: timeSlotId }),
	z.object({ ref: timeSlotRef }),
]);

export const timeSlotFilter = z.object({
	courseId: z.number().optional(),
});
