import { z } from "zod";
import { courseId, examId, questionRefId, slug } from "./base";
import { courseNaturalKey } from "./course";

export const examStatus = z.enum([
	"DRAFT",
	"ARCHIVED",
	"SCHEDULED",
	"ONGOING",
	"COMPLETED",
]);

export const examType = z.enum(["PRACTICE", "QUIZ", "EXAM", "FINAL"]);

export const textFormat = z.enum(["PLAINTEXT", "MARKDOWN", "HTML"]);

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
	courseId: courseId,
	slug: slug,

	type: examType,
	status: examStatus,

	title: z.string().min(1),
	description: z.string().nullable(),
	preamble: z.string().nullable(),
	format: textFormat,

	scheduledAt: z.date().nullable(),
	durationMs: z.number().int().positive().nullable(),
	extraTimeMs: z.number().int().nonnegative(),

	authorId: z.string(),

	tags: z.array(z.string().min(1)),
	questions: z.array(examQuestionSchema),

	createdAt: z.date(),
	updatedAt: z.date(),
});

export const examCreate = examSchema
	.omit({
		id: true,
		courseId: true,
		authorId: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		courseId: z.union([courseId, courseNaturalKey]),

		type: examType.optional(),
		status: examStatus.optional(),
		format: textFormat.optional(),

		description: z.string().nullish(),
		preamble: z.string().nullish(),
		scheduledAt: z.date().nullish(),
		durationMs: z.number().int().positive().nullish(),
		extraTimeMs: z.number().int().nonnegative().optional(),

		tags: z.array(z.string().min(1)).optional(),
		questions: z.array(examQuestionInput).optional(),
	});

export const examUpsert = examCreate;

export const examUpdate = examCreate
	.omit({ slug: true, courseId: true })
	.partial();

export const examNaturalKey = courseNaturalKey.extend({ slug: slug });

export const examPK = z.union([
	z.object({ id: examId }),
	z.object({ courseId: courseId, slug: slug }),
	examNaturalKey,
]);

export const examFilterBase = z.object({
	slugs: z.array(slug).optional(),
	statuses: z.array(examStatus).optional(),
	types: z.array(examType).optional(),
	tags: z.array(z.string().min(1)).optional(),
});

export const examFilter = z.union([
	examFilterBase.extend({ courseId: courseId }),
	examFilterBase.extend(courseNaturalKey.shape),
]);
