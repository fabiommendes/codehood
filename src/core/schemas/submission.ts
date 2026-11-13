import { z } from "zod";
import {
	instant,
	publicId,
	questionRefId,
	responseId,
	slug,
	submissionId,
	username,
} from "./base";
import { courseRef } from "./course";

export const submissionStatus = z.enum([
	"PENDING_GRADE",
	"WILL_NOT_GRADE",
	"GRADED_AUTOMATICALLY",
	"GRADED_MANUALLY",
	"PRETEST_FAILED",
]);

/// How a submission came to exist: typed (`AUTOSAVE`), sent for grading (`SUBMIT`) or the last autosave promoted when the attempt closed (`FINAL`).
export const submissionKind = z.enum(["AUTOSAVE", "SUBMIT", "FINAL"]);

/// The kinds a client may ask for; `FINAL` is only ever made by closing the attempt.
export const submissionKindRequested = z.enum(["AUTOSAVE", "SUBMIT"]);

/**
 * A student's response to one question, as mdq `docs/responses.md` defines it,
 * or `null` for a skipped question.
 *
 * The shape depends on the question's type, so it is checked against the
 * question when the submission is created rather than here.
 */
export const submissionPayload = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.array(z.unknown()).readonly(),
	z.record(z.string(), z.unknown()).readonly(),
	z.null(),
]);

/// Identifies a response from outside the response schema, which imports this module.
export const responseRef = z.union([
	z.object({ id: responseId }),
	z.object({
		publicId: publicId,
		/// When given, a response from any other course is not found.
		course: courseRef.optional(),
	}),
]);

export const submissionSchema = z.object({
	id: submissionId,
	publicId: publicId,

	responseId: responseId,
	questionId: questionRefId,

	/// The response this answer belongs to, by `publicId`.
	response: publicId,
	/// The question this answers, by slug.
	question: slug,

	status: submissionStatus,
	/// Server state: how the submission came to exist.
	kind: submissionKind,
	automaticallyTriggered: z.boolean(),
	payload: submissionPayload,

	startedAt: z.date().nullable(),
	createdAt: z.date(),
});

export const submissionCreate = submissionSchema
	.omit({
		id: true,
		publicId: true,
		responseId: true,
		questionId: true,
		response: true,
		question: true,
		createdAt: true,
		kind: true,
	})
	.extend({
		response: responseRef,
		/// When given, a response from any other course is not found.
		course: courseRef.optional(),

		/// The question being answered, which must be one the exam carries.
		question: slug,

		status: submissionStatus.optional(),
		automaticallyTriggered: z.boolean().optional(),
		startedAt: instant.nullish(),
	});

/// Only the grading status moves. An attempt's payload is the record of what the student sent.
export const submissionUpdate = submissionSchema
	.pick({ status: true })
	.partial();

export const submissionPK = z.union([
	z.object({ id: submissionId }),
	z.object({
		publicId: publicId,
		/// When given, a submission from any other course is not found.
		course: courseRef.optional(),
	}),
]);

export const submissionFilterBase = z.object({
	response: responseRef.optional(),
	question: slug.optional(),
	exam: slug.optional(),
	author: username.optional(),
	/// `true` keeps only submissions made in practice attempts.
	practice: z.boolean().optional(),
	statuses: z.array(submissionStatus).optional(),
	automaticallyTriggered: z.boolean().optional(),
});

export const submissionFilter = submissionFilterBase.extend({
	course: courseRef,
});
