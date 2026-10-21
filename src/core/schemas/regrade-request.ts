import { z } from "zod";
import { m } from "@/i18n";
import { isPercentScore, SCORE_ERROR } from "../score";
import {
	feedbackId,
	publicId,
	regradeRequestId,
	slug,
	submissionId,
	username,
} from "./base";
import { courseRef } from "./course";
import { examParams } from "./exam";
import { score } from "./feedback";

/// How many days after the release of an exam's grades its students may still ask for a regrade.
export const REGRADE_WINDOW_DAYS = 14;

/// The longest justification or reply, in characters after trimming.
export const REGRADE_TEXT_MAX = 2000;

/// The shortest justification a student may send, in characters after trimming.
export const REGRADE_MESSAGE_MIN = 10;

export const regradeStatus = z.enum(["OPEN", "ACCEPTED", "REJECTED"]);
export type RegradeStatus = z.infer<typeof regradeStatus>;

/// A student's justification, trimmed, from 10 to 2000 characters.
export const regradeMessage = z
	.string()
	.trim()
	.min(
		REGRADE_MESSAGE_MIN,
		m.forms_schema_regrade_message_min({ min: REGRADE_MESSAGE_MIN }),
	)
	.max(
		REGRADE_TEXT_MAX,
		m.forms_schema_regrade_message_max({ max: REGRADE_TEXT_MAX }),
	)
	.meta({
		form: { label: m.forms_label_regrade_message(), widget: "textarea" },
	});

/// The instructor's answer to a request, trimmed, from 1 to 2000 characters.
export const regradeReply = z
	.string()
	.trim()
	.min(1, m.forms_schema_regrade_reply_required())
	.max(
		REGRADE_TEXT_MAX,
		m.forms_schema_regrade_reply_max({ max: REGRADE_TEXT_MAX }),
	)
	.meta({ form: { label: m.forms_label_regrade_reply(), widget: "textarea" } });

/**
 * A student's request to review the grade of one answer, with the instructor's answer once resolved.
 *
 * `exam`, `question` and `author` are read through the contested submission;
 * the request itself stores none of them.
 */
export const regradeRequestSchema = z.object({
	id: regradeRequestId,
	publicId: publicId,

	submissionId: submissionId,
	/// The contested submission, by `publicId`.
	submission: publicId,

	/// The exam of the contested answer, by slug.
	exam: slug,
	/// The question of the contested answer, by slug.
	question: slug,
	/// The student who wrote the contested answer.
	author: username,

	message: z.string(),
	status: regradeStatus,

	/// The instructor's answer; `null` while `OPEN`.
	reply: z.string().nullable(),
	/// The grading pass written on acceptance; `null` unless `ACCEPTED` (or the pass was deleted since).
	feedbackId: feedbackId.nullable(),
	resolvedBy: username.nullable(),
	resolvedAt: z.date().nullable(),

	createdAt: z.date(),
	updatedAt: z.date(),
});

/// A student contests the counting answer `submission` of a course they take.
export const regradeRequestCreate = regradeRequestSchema
	.pick({ submission: true })
	.extend({
		course: courseRef,
		message: regradeMessage,
	});

export const regradeRequestPK = z.union([
	z.object({ id: regradeRequestId }),
	z.object({
		publicId: publicId,
		/// When given, a request from any other course is not found.
		course: courseRef.optional(),
	}),
]);

export const regradeRequestFilterBase = z.object({
	exam: slug.optional(),
	status: regradeStatus.optional(),
	/// The student who wrote the contested answer.
	author: username.optional(),
});

export const regradeRequestFilter = regradeRequestFilterBase.extend({
	course: courseRef,
});

/// Accepting writes a grading pass with `score` (as in `feedbackCreate`) and `reply` as its comment.
export const regradeAccept = z.object({
	score: score,
	reply: regradeReply,
});

export const regradeReject = z.object({
	reply: regradeReply,
});

//
// Action inputs: URL segments of the exam page plus the form fields.
//

/// What the student's "ask for a regrade" dialog sends.
export const regradeRequestForm = examParams.extend({
	/// The counting submission being contested, by `publicId`.
	submission: z.string().min(1),
	message: regradeMessage,
});

/// Addresses one request from an exam page, by its `publicId`.
export const regradeRequestRef = examParams.extend({
	request: z.string().min(1),
});

/// What the instructor's accept form sends: the percentage as typed (0 to 100) and the reply.
export const regradeAcceptForm = regradeRequestRef.extend({
	score: z
		.string({ error: SCORE_ERROR })
		.refine(isPercentScore, SCORE_ERROR)
		.meta({ form: { label: m.forms_label_regrade_score() } }),
	reply: regradeReply,
});

/// What the instructor's reject form sends.
export const regradeRejectForm = regradeRequestRef.extend({
	reply: regradeReply,
});
