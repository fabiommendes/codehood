import type { JSX } from "solid-js";
import QuestionPreview from "@/components/question/QuestionPreview";
import type { QuestionDocument } from "@/mdq";
import type { CodeBlocksHtml } from "@/utils/code-blocks";

export interface AnswerKeyProps {
	/// The full authored question, answer key included.
	question: QuestionDocument;
	/// The highlighted fenced blocks of `question`, from `highlightQuestionCodeBlocks`.
	codeBlocks?: CodeBlocksHtml;
}

/** A question with its correct answer marked, without the student/key toggle. */
export default function AnswerKey(props: AnswerKeyProps): JSX.Element {
	return (
		<QuestionPreview
			data={props.question}
			tab={() => "key"}
			hideScore
			codeBlocks={props.codeBlocks}
		/>
	);
}
