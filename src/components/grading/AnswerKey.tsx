import type { JSX } from "solid-js";
import QuestionPreview from "@/components/question/QuestionPreview";
import type { QuestionDocument } from "@/mdq";

export interface AnswerKeyProps {
	/// The full authored question, answer key included.
	question: QuestionDocument;
}

/** A question with its correct answer marked, without the student/key toggle. */
export default function AnswerKey(props: AnswerKeyProps): JSX.Element {
	return <QuestionPreview data={props.question} tab={() => "key"} hideScore />;
}
