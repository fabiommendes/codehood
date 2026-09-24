import { z } from "zod";
import { feedbackId, publicId, slug, submissionId, username } from "./base";
import { courseRef } from "./course";
import { submissionPK } from "./submission";

/// Identifies the submission a feedback grades.
export const submissionRef = submissionPK;

const SCORE_RE = /^-?(\d+(\.\d+)?|\d+\/\d+)$/;

/// The numeric value of a score string, or `null` when the denominator is zero.
function scoreValue(text: string): number | null {
	const negative = text.startsWith("-");
	const digits = negative ? text.slice(1) : text;
	const slashAt = digits.indexOf("/");

	let magnitude: number;
	if (slashAt < 0) {
		magnitude = Number(digits);
	} else {
		const denominator = Number(digits.slice(slashAt + 1));
		if (denominator === 0) return null;
		magnitude = Number(digits.slice(0, slashAt)) / denominator;
	}

	return negative ? -magnitude : magnitude;
}

/**
 * A grade as an exact decimal or `n/d` fraction in `[-1, 1]`, either form
 * signed: `0.5`, `-0.25`, `1/3`, `-2/3`.
 *
 * Kept as the string the caller sent rather than a float, so a third stays a
 * third. Validation reads the value but never rewrites the text.
 */
export const score = z
	.string()
	.regex(SCORE_RE, "Expected a decimal or an 'n/d' fraction.")
	.refine((text) => {
		const value = scoreValue(text);
		return value !== null && value >= -1 && value <= 1;
	}, "Score must be a number between -1 and 1.");

export const feedbackSchema = z.object({
	id: feedbackId,

	/// Supplied by the writer and unique within the submission, so a grading
	/// pass is addressed by a name its author chose rather than by a number
	/// the server hands out. Constrained to a slug because it is a URL segment.
	ref: slug,

	submissionId: submissionId,

	/// The submission this pass grades, by `publicId`.
	submission: publicId,

	score: score,

	/// The user who graded, or `null` when a bot did.
	grader: username.nullable(),

	/// The bot that graded, or `null` when a user did.
	bot: z.string().nullable(),

	feedback: z.string().nullable(),

	createdAt: z.date(),
	updatedAt: z.date(),
});

export const feedbackCreate = feedbackSchema
	.omit({
		id: true,
		submissionId: true,
		submission: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		/// The submission being graded.
		submission: submissionRef,

		/// Defaults to the actor, who is the only grader a user may write.
		grader: username.nullish(),

		bot: z.string().nullish(),
		feedback: z.string().nullish(),
	});

/// Re-grading appends another pass; only the verdict moves on an existing one.
export const feedbackUpdate = feedbackSchema
	.pick({ score: true, feedback: true })
	.partial();

export const feedbackPK = z.union([
	z.object({ id: feedbackId }),
	z.object({ submission: submissionRef, ref: slug }),
]);

export const feedbackFilterBase = z.object({
	submission: submissionRef.optional(),
	exam: slug.optional(),
	question: slug.optional(),

	/// The student whose work was graded.
	author: username.optional(),

	grader: username.optional(),
	bot: z.string().optional(),

	/// `true` keeps only the passes a bot made, `false` only the ones a user made.
	automated: z.boolean().optional(),
});

export const feedbackFilter = feedbackFilterBase.extend({ course: courseRef });
