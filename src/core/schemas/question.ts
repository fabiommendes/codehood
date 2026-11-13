import { z } from "zod";
import { type QuestionType as MdqQuestionType, questionDocument } from "@/mdq";
import { publicQuestionSchema } from "@/mdq/public-schema";
import type { AssertEqual } from "@/utils/types";
import { questionRefId, rev, rowVersion, slug } from "./base";
import { courseRef } from "./course";

export const questionSchema = z.object({
	slug: slug,
	id: questionRefId,
	status: z.enum(["DRAFT", "PUBLISHED", "HIDDEN", "ARCHIVED"]),
	version: z.string().min(1),
	rev: rev.nullable(),
	createdAt: z.date(),
	updatedAt: z.date(),

	/// The MDQ document representing the question.
	question: questionDocument,
});

export const questionPublicSchema = questionSchema
	.omit({ question: true })
	.extend({
		question: publicQuestionSchema,
	});

export const questionCreate = questionSchema
	.omit({ createdAt: true, updatedAt: true, id: true })
	.extend({
		course: courseRef,
		rev: rev.nullish(),
	});

export const questionUpdate = questionCreate
	.omit({ slug: true, course: true })
	.partial();

/**
 * Which view a read returns: `true` forces the public half, `false` demands
 * the whole document, and leaving it out gives whatever the actor may see.
 */
export const questionFindOneQuery = z.object({
	public: z.boolean().optional(),
});
const questionPKPublicFlag = questionFindOneQuery.shape;

export const questionPK = z.union([
	z.object({ id: questionRefId, ...questionPKPublicFlag }),
	z.object({ publicId: z.string().min(1), ...questionPKPublicFlag }),
	z.object({ course: courseRef, slug: slug, ...questionPKPublicFlag }),
]);

/// Which stored version a read returns: the one whose `versionHash` is `version`, or the latest when absent or `null`.
const questionPKVersion = {
	version: z.string().min(1).nullish(),
};

/**
 * A primary key, plus the version a service read should return.
 *
 * Service-only: the REST key stays `questionPK`, so the API never reads an
 * older version.
 */
export const questionFindOneFilter = z.union([
	z.object({
		id: questionRefId,
		...questionPKPublicFlag,
		...questionPKVersion,
	}),
	z.object({
		publicId: z.string().min(1),
		...questionPKPublicFlag,
		...questionPKVersion,
	}),
	z.object({
		course: courseRef,
		slug: slug,
		...questionPKPublicFlag,
		...questionPKVersion,
	}),
]);

export const questionFilterBase = z.object({
	slugs: z.array(slug).optional(),
	statuses: z.array(z.lazy(() => questionStatus)).optional(),
	types: z.array(z.lazy(() => questionType)).optional(),
	tags: z.array(z.string()).optional(),
	...questionPKPublicFlag,
});

export const questionFilter = questionFilterBase.extend({ course: courseRef });

export const questionStatus = questionSchema.shape.status;

export const questionType = z.enum([
	"multiple-choice",
	"multiple-selection",
	"true-false",
	"essay",
	"numeric",
	"short-answer",
	"fill-in",
	"ordering",
	"code",
]);
export type QuestionType = z.infer<typeof questionType>;
true satisfies AssertEqual<QuestionType, MdqQuestionType>;

/// The question bank's status control: a question by URL segments, the status to move it to and the version the table last read.
export const questionStatusUpdate = z.object({
	discipline: z.string().min(1),
	course: z.string().min(1),
	slug: z.string().min(1),
	status: questionStatus,
	updatedAt: rowVersion,
});

/// The default of `meta.attempts`.
const DEFAULT_ATTEMPTS = 4;

/// The default of `meta.penalty`.
const DEFAULT_PENALTY = "0.2";

/// A decimal in [0, 1] spelled without an exponent.
const PENALTY_PATTERN = /^(?:[01](?:\.0+)?|0\.\d+)$/;

/**
 * The `meta` of a code question: the worker that grades it and the submission
 * policy, as the columns of `QuestionRef` hold them.
 *
 * Other keys of `meta` are ignored. Parse `question.meta` (possibly
 * `undefined`) to get the effective values, with the defaults applied.
 */
export const codeQuestionMeta = z
	.object({
		worker: z
			.string()
			.min(1)
			.max(40)
			.regex(/^[a-z0-9-]+$/)
			.nullish()
			.transform((worker) => worker ?? null),
		attempts: z.number().int().min(1).default(DEFAULT_ATTEMPTS),
		penalty: z
			.union([z.number(), z.string()])
			.transform(String)
			.pipe(z.string().regex(PENALTY_PATTERN))
			.default(DEFAULT_PENALTY),
	})
	.default({
		worker: null,
		attempts: DEFAULT_ATTEMPTS,
		penalty: DEFAULT_PENALTY,
	});
/** The effective worker, attempts and penalty of a code question. */
export type CodeQuestionMeta = z.infer<typeof codeQuestionMeta>;
