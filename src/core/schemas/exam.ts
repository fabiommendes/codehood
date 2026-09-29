import { z } from "zod";
import { duration, examId, questionRefId, rev, slug } from "./base";
import { courseRef } from "./course";

export const examStatus = z.enum([
	"DRAFT",
	"ARCHIVED",
	"SCHEDULED",
	"ONGOING",
	"COMPLETED",
]);

export const examType = z.enum(["PRACTICE", "QUIZ", "EXAM"]);

export const textFormat = z.enum(["PLAINTEXT", "MARKDOWN", "HTML"]);

/// How long an exam runs. A zero length is refused: an untimed exam has none.
export const examDuration = duration.refine(
	(d) => (d.hours ?? 0) + (d.minutes ?? 0) > 0,
	{ message: "Duration must be longer than zero" },
);

/// A question in an exam, pinned to the version the exam was assembled with.
export const examQuestionSchema = z.object({
	id: questionRefId,
	slug: slug,
	version: z.string().min(1).nullable(),
});

/// A question reference on the way in, by slug within the exam's own course.
export const examQuestionInput = z.object({
	slug: slug,
	version: z.string().min(1).nullish(),
});

export const examSchema = z.object({
	id: examId,
	slug: slug,

	type: examType,
	status: examStatus,

	title: z.string().min(1),
	description: z.string().nullable(),
	preamble: z.string().nullable(),
	format: textFormat,

	scheduledAt: z.date().nullable(),
	duration: duration.nullable(),
	extraTime: duration.nullable(),

	/// When the instructor released an `EXAM`'s grades. Read-only here.
	gradesReleasedAt: z.date().nullable(),

	author: z.string(),
	rev: rev.nullable(),

	tags: z.array(z.string().min(1)),
	questions: z.array(examQuestionSchema),

	createdAt: z.date(),
	updatedAt: z.date(),
});

export const examCreate = examSchema
	.omit({
		id: true,
		author: true,
		extraTime: true,
		gradesReleasedAt: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		course: courseRef,

		type: examType.optional(),
		status: examStatus.optional(),
		format: textFormat.optional(),

		description: z.string().nullish(),
		preamble: z.string().nullish(),
		scheduledAt: z.date().nullish(),
		duration: examDuration.nullish(),
		rev: rev.nullish(),

		tags: z.array(z.string().min(1)).optional(),
		questions: z.array(examQuestionInput).optional(),
	});

/// Extra time is granted to an existing exam, so only an update carries it.
export const examUpdate = examCreate
	.omit({ slug: true, course: true })
	.extend({ extraTime: duration.nullish() })
	.partial();

export const examPK = z.union([
	z.object({ id: examId }),
	z.object({ course: courseRef, slug: slug }),
]);

export const examFilterBase = z.object({
	exams: z.array(slug).optional(),
	statuses: z.array(examStatus).optional(),
	types: z.array(examType).optional(),
	tags: z.array(z.string().min(1)).optional(),
});

export const examFilter = examFilterBase.extend({ course: courseRef });
