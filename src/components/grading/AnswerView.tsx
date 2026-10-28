import type { JSX } from "solid-js";
import type { AnswerPayload } from "@/components/exam/answer-payload";
import { AnyQuestionView, mdqMessages } from "@/components/question/mdq";
import type { QuestionPublic } from "@/db";

export interface AnswerViewProps {
	/// The public form of the question, as the student saw it.
	question: QuestionPublic["question"];
	/// The student's saved answer, or nothing to show the question alone.
	payload?: AnswerPayload;
}

/**
 * A question frozen on a student's saved answer, or on nothing when there is no answer.
 *
 * It is an island of its own, and not plain server markup, so each copy gets
 * ids of its own and the radio groups of two answers never share a name.
 */
export default function AnswerView(props: AnswerViewProps): JSX.Element {
	return (
		<AnyQuestionView
			question={props.question}
			mode="readonly"
			value={props.payload ?? null}
			messages={mdqMessages}
		/>
	);
}
