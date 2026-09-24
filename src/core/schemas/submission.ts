import { z } from "zod";
import {
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
]);

/**
 * A student's answer to one question.
 *
 * The shape depends on the question's type, so it is checked against the
 * question when the submission is created rather than here.
 */
export const submissionPayload = z.record(z.string(), z.unknown());

/// Identifies a response from outside the response schema, which imports this module.
export const responseRef = z.union([
	z.object({ id: responseId }),
	z.object({ publicId: publicId }),
]);

export const submissionSchema = z.object({
	id: submissionId,
	publicId: publicId,

	responseId: responseId,
	questionId: questionRefId,

	status: submissionStatus,
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
		createdAt: true,
	})
	.extend({
		response: responseRef,

		/// The question being answered, which must be one the exam carries.
		question: slug,

		status: submissionStatus.optional(),
		automaticallyTriggered: z.boolean().optional(),
		startedAt: z.date().nullish(),
	});

/// Only the grading status moves. An attempt's payload is the record of what the student sent.
export const submissionUpdate = submissionSchema
	.pick({ status: true })
	.partial();

export const submissionPK = z.union([
	z.object({ id: submissionId }),
	z.object({ publicId: publicId }),
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
