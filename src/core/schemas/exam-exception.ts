import { z } from "zod";
import { m } from "@/i18n";
import {
	duration,
	examExceptionId,
	examId,
	instant,
	slug,
	username,
} from "./base";
import { courseRef } from "./course";
import { examParams } from "./exam";

/// The longest extra time one exception may grant.
export const EXAM_EXCEPTION_MAX_EXTRA_MINUTES = 24 * 60;

/// Extra time granted to one student, from zero up to 24 hours.
export const exceptionExtraTime = duration.refine(
	(d) =>
		(d.hours ?? 0) * 60 + (d.minutes ?? 0) <= EXAM_EXCEPTION_MAX_EXTRA_MINUTES,
	{ message: m.forms_schema_extra_time_max() },
);

/**
 * One student's adjustment to an exam's timing, as the course's instructor sees it.
 *
 * `extraTime` is `null` when the exception grants none (a makeup date alone).
 */
export const examExceptionSchema = z.object({
	id: examExceptionId,
	examId: examId,
	/// The exam this exception adjusts, by slug.
	exam: slug,
	username: username,

	extraTime: duration.nullable(),
	scheduledAt: z.date().nullable(),
	note: z.string().nullable(),

	createdAt: z.date(),
	updatedAt: z.date(),
});

/// The exception as its own student sees it: the instructor's note is left out.
export const examExceptionPublicSchema = examExceptionSchema.omit({
	note: true,
});

export const examExceptionCreate = examExceptionSchema
	.omit({
		id: true,
		examId: true,
		extraTime: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		course: courseRef,

		/// Absent or `null` grants no extra time.
		extraTime: exceptionExtraTime.nullish(),
		scheduledAt: instant.nullish(),
		note: z.string().nullish(),
	});

// The exam and the student are the natural key: moving an exception to
// another student is a delete plus a create.
export const examExceptionUpdate = examExceptionCreate
	.omit({ course: true, exam: true, username: true })
	.partial();

export const examExceptionPK = z.object({
	course: courseRef,
	exam: slug,
	username: username,
});

export const examExceptionFilterBase = z.object({
	exam: slug.optional(),
	username: username.optional(),
});

export const examExceptionFilter = examExceptionFilterBase.extend({
	course: courseRef,
});

/// Grants or changes one student's exception from the exam page; the dialog sends minutes and a local date.
export const examExceptionSave = examParams.extend({
	username: username.meta({
		form: { label: m.forms_label_exception_student() },
	}),
	extraMinutes: z
		.number()
		.int()
		.min(0)
		.max(EXAM_EXCEPTION_MAX_EXTRA_MINUTES)
		.optional()
		.meta({ form: { label: m.forms_label_exception_extra_minutes() } }),
	scheduledAt: z.iso
		.datetime({ local: true })
		.optional()
		.meta({ form: { label: m.forms_label_exception_scheduled_at() } }),
	note: z
		.string()
		.trim()
		.max(500)
		.optional()
		.meta({ form: { label: m.forms_label_exception_note() } }),
});

/// Removes one student's exception, addressed by URL segments.
export const examExceptionRemove = examParams.extend({ username: username });
