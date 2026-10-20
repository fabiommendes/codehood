import { z } from "zod";
import { isPercentScore, SCORE_ERROR } from "../score";

/// Addresses one answer the way the grading pages do: the course's URL segments, the exam slug and the submission's `publicId`.
export const answerRef = z.object({
	discipline: z.string().min(1),
	course: z.string().min(1),
	exam: z.string().min(1),
	submission: z.string().min(1),
});

/// What the grading form sends: the answer, the percentage as typed, and an optional comment.
export const answerGrade = answerRef.extend({
	score: z
		.string({ error: SCORE_ERROR })
		.refine(isPercentScore, SCORE_ERROR)
		.meta({ form: { label: "Score (%)" } }),
	comment: z
		.string()
		.optional()
		.meta({ form: { widget: "textarea" } }),
});

/// What the will-not-grade dialog sends: the answer and an optional comment for the student.
export const answerWillNotGrade = answerRef.extend({
	comment: z
		.string()
		.optional()
		.meta({
			form: { label: "Comment for the student", widget: "textarea" },
		}),
});
