import { z } from "zod";
import { courseId, examId, publicId, responseId, slug, username } from "./base";
import { courseRef } from "./course";
import { responseRef, submissionPayload, submissionSchema } from "./submission";

export const responsePK = responseRef;

export const responseSchema = z.object({
	id: responseId,
	publicId: publicId,

	courseId: courseId,
	examId: examId,
	/// The exam this attempt belongs to, by slug.
	exam: slug,

	author: username,

	/**
	 * When this practice session started, or `null` for a graded exam.
	 *
	 * The stored form is `slotKey`, an integer the unique index can constrain;
	 * a graded exam's zero surfaces here as `null`.
	 */
	practiceSession: z.date().nullable(),

	acceptingSubmissions: z.boolean(),

	/// Every question answered in this attempt, oldest first.
	submissions: z.array(submissionSchema),

	createdAt: z.date(),
	updatedAt: z.date(),
});

export const responseCreate = responseSchema
	.omit({
		id: true,
		publicId: true,
		courseId: true,
		examId: true,
		exam: true,
		author: true,
		practiceSession: true,
		submissions: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		course: courseRef,
		exam: slug,

		/// Defaults to the actor, who is the only author a student may write.
		author: username.optional(),

		/**
		 * Which attempt at a practice exam this is, defaulting to the session
		 * open now. Refused on a graded exam, which a student answers once.
		 */
		practiceSession: z.date().nullish(),

		acceptingSubmissions: z.boolean().optional(),
	});

/// Closing or reopening the attempt is the only field a caller moves directly.
export const responseUpdate = responseSchema
	.pick({ acceptingSubmissions: true })
	.partial();

export const responseFilterBase = z.object({
	exam: slug.optional(),
	author: username.optional(),

	/// `true` keeps only practice attempts, `false` only graded ones.
	practice: z.boolean().optional(),

	acceptingSubmissions: z.boolean().optional(),
});

export const responseFilter = responseFilterBase.extend({ course: courseRef });

/**
 * Answers one question of an exam, resolving the attempt it belongs to.
 *
 * The client that answers a question does not know whether it has started the
 * exam already, and should not have to ask.
 */
export const responseSubmit = z.object({
	course: courseRef,
	exam: slug,
	question: slug,

	/// Defaults to the actor.
	author: username.optional(),

	payload: submissionPayload,
	startedAt: z.date().nullish(),
	automaticallyTriggered: z.boolean().optional(),
});
