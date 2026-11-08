import { z } from "zod";
import { m } from "@/i18n";
import { isPercentScore, SCORE_ERROR } from "../score";
import { slug } from "./base";
import { blankGrade, score } from "./feedback";
import {
	rubricBase,
	rubricItemCreate,
	rubricItemUpdate,
	rubricKey,
	rubricRenameGroup,
	rubricSplit,
} from "./rubric";

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
		.meta({ form: { label: m.forms_label_score_percent() } }),
	comment: z
		.string()
		.optional()
		.meta({ form: { label: m.forms_label_comment(), widget: "textarea" } }),
});

/// What the will-not-grade dialog sends: the answer and an optional comment for the student.
export const answerWillNotGrade = answerRef.extend({
	comment: z
		.string()
		.optional()
		.meta({
			form: { label: m.forms_label_student_comment(), widget: "textarea" },
		}),
});

/// What the per-blank grading form sends: the grade of each pending blank of a fill-in answer, and an optional comment.
export const answerGradeBlanks = answerRef.extend({
	blanks: z.record(slug, blankGrade),
	comment: z.string().optional(),
});

/// What the rubric grading view sends to save an answer: the keys of the items applied, an adjustment, a free comment, and the `ref` of the grade to revise.
export const answerGradeRubric = answerRef.extend({
	rubric: z.array(z.string()),
	adjustment: score.optional(),
	comment: z.string().optional(),
	/// The pass to revise; a new pass is written without it.
	ref: slug.optional(),
});

/// Addresses the question the rubric grading view works on, the way the grading pages do.
export const gradingQuestion = answerRef.omit({ submission: true }).extend({
	question: z.string().min(1),
});

/// What the grading view sends to add an item to the rubric.
export const gradingItemAdd = gradingQuestion.extend(rubricItemCreate.shape);

/// What the grading view sends to split an item of the rubric.
export const gradingItemSplit = gradingQuestion.extend({
	key: rubricKey,
	...rubricSplit.shape,
});

/// What the grading view sends to rename a group of the rubric.
export const gradingGroupRename = gradingQuestion.extend(
	rubricRenameGroup.shape,
);

/// What the grading view sends to edit the rubric: a new base, changed items and items to delete, applied together or only counted when `dryRun`.
export const gradingRubricEdit = gradingQuestion.extend({
	base: rubricBase.optional(),
	items: z.array(rubricItemUpdate.extend({ key: rubricKey })).default([]),
	deleted: z.array(rubricKey).default([]),
	/// Count the scores the change moves and write nothing.
	dryRun: z.boolean().default(false),
});
