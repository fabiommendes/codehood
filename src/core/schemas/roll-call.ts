import { z } from "zod";
import { courseId, rollCallId, slug, username } from "./base";
import { calendarEventPK, calendarEventSchema } from "./calendar-event";
import { courseRef } from "./course";
import { enrollmentSchema } from "./enrollment";

export const rollCallSchema = z.object({
	id: rollCallId,
	courseId: courseId,
	week: z.number().int(),
	timeSlot: slug,
	actsAsInvite: z.boolean(),
	/// End of the current window. Only `open` and `close` change it.
	closesAt: z.date(),
	/// Keyed by username. A student reads only their own entry.
	attendances: z.record(
		username,
		z.lazy(() => attendanceSchema),
	),
	createdAt: z.date(),
	updatedAt: z.date(),
});

/// One student's presence in a roll call, as it leaves the service.
export const attendanceSchema = z.object({
	source: z.enum(["CODE", "MANUAL"]),
	joined: z.enum(["ENROLLMENT", "ACCOUNT"]).nullable(),
	note: z.string().nullable(),
	/// Other students of this roll call who checked in from the same browser.
	sharedWith: z.array(username),
	createdAt: z.date(),
});

/// Opens the roll call of an event for 15 min.
export const rollCallCreate = rollCallSchema
	.pick({ actsAsInvite: true })
	.extend({
		event: calendarEventPK,
		actsAsInvite: z.boolean().default(false),
	});

/// Merge semantics: `null` removes a student, an absent key is left alone.
export const rollCallUpdate = rollCallSchema
	.pick({ actsAsInvite: true })
	.extend({
		attendances: z.record(
			username,
			attendanceSchema
				.pick({ note: true })
				.extend({ note: z.string().trim().max(200).nullish() })
				.nullable(),
		),
	})
	.partial();

export const rollCallPK = z.union([
	z.object({ id: rollCallId }),
	z.object({ course: courseRef, week: z.number().int(), timeSlot: slug }),
]);

export const rollCallFilter = z.object({ course: courseRef });

export const attendanceCellSchema = z.enum([
	"present",
	"absent",
	"before-enrollment",
]);

export const courseAttendanceSchema = z.object({
	/// Events that had a roll call, in date order.
	events: z.array(
		calendarEventSchema
			.pick({ week: true, title: true, startAt: true })
			.extend({ timeSlot: slug }),
	),
	/// Enrolled students, DROPPED included. A student sees only themself.
	students: z.array(
		enrollmentSchema
			.pick({
				username: true,
				name: true,
				email: true,
				schoolId: true,
				status: true,
			})
			.extend({
				/// By `${week}/${timeSlot}`.
				cells: z.record(z.string(), attendanceCellSchema),
				present: z.number().int(),
				/// Every roll call of the course; "before-enrollment" counts as absence.
				total: z.number().int(),
			}),
	),
});

/// A check-in with a code typed or scanned now.
export const checkInInput = z.object({
	code: z.string(),
	/// Absent when the student typed the code without choosing a roll call.
	rollCallId: rollCallId.optional(),
	/// Raw value of the per-browser device cookie.
	deviceId: z.string().min(1),
});

/// A check-in whose code was verified earlier, completed after login or signup.
export const checkInClaimInput = z.object({
	rollCallId: rollCallId,
	/// The instant the code was verified.
	claimedAt: z.date(),
	deviceId: z.string().min(1),
	accountCreated: z.boolean(),
});

export const checkInResultSchema = z.object({
	rollCall: rollCallPK,
	title: z.string(),
	startAt: z.date(),
	/// Set when this check-in created the enrollment or the account.
	joined: attendanceSchema.shape.joined,
});
