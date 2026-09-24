import { z } from "zod";
import { clockTime, courseId, duration, slug, timeSlotId } from "./base";
import { courseRef } from "./course";

export const timeSlotSchema = z.object({
	id: timeSlotId,
	courseId: courseId,
	slug: slug,
	title: z.string().nullable(),
	day: z.lazy(() => weekdaySchema),
	start: clockTime,
	duration: duration,
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
	.omit({ id: true, courseId: true, createdAt: true, updatedAt: true })
	.extend({
		course: courseRef,

		// Nullable column: `null` clears the title, absent leaves it unset.
		title: z.string().nullish(),
	});

// `slug` and `course` are deliberately absent: `slug` is the sync natural
// key, and changing it is a delete plus a create (FR-SYNC-011).
export const timeSlotUpdate = timeSlotCreate
	.omit({ course: true, slug: true })
	.partial();

export const timeSlotPK = z.union([
	z.object({ id: timeSlotId }),
	z.object({ course: courseRef, slug: slug }),
]);

export const timeSlotFilterBase = z.object({
	days: z.array(weekdaySchema).optional(),
});

export const timeSlotFilter = timeSlotFilterBase.extend({ course: courseRef });
