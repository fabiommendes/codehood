import type { JSX } from "solid-js";
import {
	type AnswerPayload,
	answersOf,
	blanksOf,
	choiceOf,
	choicesOf,
	essayOf,
	numberOf,
	textOf,
} from "@/components/exam/answer-payload";
import QuestionView, {
	type QuestionViewProps,
} from "@/components/question/QuestionView";
import type { QuestionPublic } from "@/db";

export interface AnswerViewProps {
	/// The public half of the question, as the student saw it.
	question: QuestionPublic["question"];
	/// The student's saved answer, or nothing to show the question alone.
	payload?: AnswerPayload;
}

/// The value the view of a question of `type` takes from a saved answer.
function savedValue(type: string, payload: AnswerPayload | undefined): unknown {
	switch (type) {
		case "multiple-choice":
			return choiceOf(payload);
		case "multiple-selection":
			return choicesOf(payload);
		case "true-false":
			return answersOf(payload);
		case "numeric":
			return numberOf(payload);
		case "short-answer":
			return textOf(payload);
		case "essay":
			return essayOf(payload);
		default:
			return blanksOf(payload);
	}
}

/**
 * A question frozen on a student's saved answer, or on nothing when there is no answer.
 *
 * It is an island of its own, and not plain server markup, so each copy gets
 * ids of its own and the radio groups of two answers never share a name.
 */
export default function AnswerView(props: AnswerViewProps): JSX.Element {
	return (
		<QuestionView
			{...({
				question: props.question,
				mode: "readonly",
				value: savedValue(props.question.type, props.payload),
			} as QuestionViewProps)}
		/>
	);
}
