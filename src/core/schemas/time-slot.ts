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

export const timeSlotCreate = timeSlotSchema
	.omit({ id: true, createdAt: true, updatedAt: true })
	.extend({
		// Nullable column: `null` clears the title, absent leaves it unset.
		title: z.string().nullish(),
	});

// `slug` and `courseId` are deliberately absent: `slug` is the sync natural
// key, and changing it is a delete plus a create (FR-SYNC-011).
export const timeSlotUpdate = timeSlotCreate
	.omit({ courseId: true, slug: true })
	.partial();

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
