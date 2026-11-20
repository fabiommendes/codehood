import type { JSX } from "solid-js";
import type { AnswerPayload } from "@/components/exam/answer-payload";
import { CodeBlocks } from "@/components/question/CodeBlocks";
import { AnyQuestionView, mdqMessages } from "@/components/question/mdq";
import type { QuestionPublic } from "@/db";
import type { ReviewResult } from "@/services/review";
import { examSubmissionFileUrl } from "@/urls";
import type { CodeBlocksHtml } from "@/utils/code-blocks";

export interface AnswerViewProps {
	/// The public form of the question, as the student saw it.
	question: QuestionPublic["question"];
	/// The student's saved answer, or nothing to show the question alone.
	payload?: AnswerPayload;
	/// The marks and feedback of the answer, shown in `review` mode without the view's own score badge.
	result?: ReviewResult;
	/// The highlighted fenced blocks of `question`, from `highlightQuestionCodeBlocks`.
	codeBlocks?: CodeBlocksHtml;
	/// Where the files of an `upload` answer are downloaded from: the course segment, the exam and the answer's submission.
	files?: { course: string; exam: string; submission: string };
	/// The answer key of an `upload` question, as guidance for the grader.
	answerKey?: string | null;
}

/**
 * A question frozen on a student's saved answer, or on nothing when there is
 * no answer, with the answer's marks when there is a result.
 *
 * It is an island of its own, and not plain server markup, so each copy gets
 * ids of its own and the radio groups of two answers never share a name.
 */
export default function AnswerView(props: AnswerViewProps): JSX.Element {
	return (
		<CodeBlocks html={props.codeBlocks}>
			<AnyQuestionView
				question={props.question}
				mode={props.result ? "review" : "readonly"}
				value={props.payload ?? null}
				result={props.result}
				hideScore
				messages={mdqMessages}
				fileUrl={(file) => {
					const { files } = props;
					return files
						? examSubmissionFileUrl(
								files.course,
								files.exam,
								files.submission,
								file.name,
							)
						: null;
				}}
				answerKey={props.answerKey}
			/>
		</CodeBlocks>
	);
}
