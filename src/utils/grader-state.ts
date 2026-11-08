import type { Rubric, RubricItem } from "@/db";
import {
	type AnswerState,
	type CountingAnswer,
	gradingOrder,
} from "@/services/grading";

/// An answer as the one-at-a-time grading view tracks it.
export interface GraderAnswer {
	/// The submission's `publicId`.
	submission: string;
	state: AnswerState;
	/// Whether the current grade applies a retired rubric item.
	review: boolean;
	/// The keys of the rubric items the current grade applies; empty when it was set by hand or there is none.
	rubric: string[];
	/// The current grade's adjustment, or an empty text.
	adjustment: string;
	/// The current grade's free comment, or an empty text.
	comment: string;
	/// The `ref` of the current grade when `username` wrote it and a new write can revise it.
	ref: string | null;
}

/// A rubric item as the grading view shows it.
export interface GraderItem {
	key: string;
	group: string | null;
	text: string;
	value: string;
	/// For the graders only.
	comment: string | null;
	feedback: string | null;
	position: number;
	/// Whether the item was split, and so cannot be newly applied.
	retired: boolean;
	/// How many answers apply it.
	uses: number;
}

/// The grading view's form of a rubric item.
export function toGraderItem(item: RubricItem): GraderItem {
	return {
		key: item.key,
		group: item.group,
		text: item.text,
		value: item.value,
		comment: item.comment,
		feedback: item.feedback,
		position: item.position,
		retired: item.retiredAt !== null,
		uses: item.uses,
	};
}

/// Everything the one-at-a-time grading view of a question starts from and refreshes to.
export interface GraderState {
	/// Credit before any item applies.
	base: string;
	items: GraderItem[];
	/// The answers in the order a grader goes through them.
	answers: GraderAnswer[];
}

/**
 * The state of the grading view: the question's `answers` in grading order and its `rubric`.
 *
 * @params answers The counting answers of the question, oldest submission first.
 * @params username The grader; only a grade they wrote is revised in place.
 */
export function graderState(
	answers: CountingAnswer[],
	rubric: Rubric,
	username: string,
): GraderState {
	return {
		base: rubric.base,
		items: rubric.items.map(toGraderItem),
		answers: gradingOrder(answers).map((answer) => {
			const current = answer.passes[0];
			return {
				submission: answer.submission,
				state: answer.state,
				review: answer.review === true,
				rubric: current?.rubric ?? [],
				adjustment: current?.adjustment ?? "",
				comment: current?.comment ?? "",
				ref:
					current?.grader === username &&
					!current.willNotGrade &&
					current.ref !== undefined
						? current.ref
						: null,
			};
		}),
	};
}
