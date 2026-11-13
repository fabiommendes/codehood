import type { LanguageId } from "@codehood/runner/protocol";
import { type JSX, Show } from "solid-js";
import { AnyQuestionView, mdqMessages } from "@/components/question/mdq";
import type { QuestionPublic } from "@/db";
import { runnerLanguage } from "@/runner/languages";
import type { ReviewResult } from "@/services/review";
import type { PretestSource } from "@/utils/pretest-sources";
import type { AnswerPayload } from "./answer-payload";
import { CodeAnswer } from "./CodeAnswer";
import { CodeEssayAnswer, type CodeEssayAnswerProps } from "./CodeEssayAnswer";
import type { CodeSends } from "./code-sends";

export interface AnswerFieldProps {
	question: QuestionPublic["question"];
	payload: AnswerPayload | undefined;
	readonly: boolean;
	/// The answer's marks and feedback, shown in `review` mode; the score is the outcome's, below.
	review?: ReviewResult;
	onChange: (payload: AnswerPayload, userEvent?: string) => void;
	/// Set for a code question being answered: it gets the editor instead of the textarea.
	code?: CodeAnswerContext;
	/// The pretest sources of an MDQ `code` question, from the server.
	pretests?: readonly PretestSource[];
	/// The highlighted example tests of an MDQ `code` question, from the server.
	exampleHtml?: readonly string[];
	/// The sends of a code question that goes to a worker; without it the question has no submit button.
	sends?: CodeSends;
	/// Sends the code of the question to its worker.
	onSubmit?: (code: string) => Promise<void>;
	/// Origin of the runner iframe the pretests run in.
	runnerOrigin?: string | null;
}

/// What a code question in answer mode needs besides the question itself.
export type CodeAnswerContext = Pick<
	CodeEssayAnswerProps,
	| "language"
	| "value"
	| "valueSavedAt"
	| "clockOffsetMs"
	| "save"
	| "codeRun"
	| "runnerOrigin"
	| "draft"
	| "onConflict"
	| "keepDraft"
>;

/** The runner language of an essay question whose answer is code a driver runs, or null. */
export function codeLanguageOf(
	question: QuestionPublic["question"],
): LanguageId | null {
	return question.type === "essay" && question.content === "code"
		? runnerLanguage(question.highlight)
		: null;
}

/** One question in answer mode, frozen on the saved answer, or reviewed with its marks. */
export function AnswerField(props: AnswerFieldProps): JSX.Element {
	return (
		<Show
			when={
				props.question.type === "code" && !props.readonly && !props.review
					? props.question
					: undefined
			}
			fallback={<EssayOrOtherField {...props} />}
		>
			{(question) => (
				<CodeAnswer
					question={question()}
					pretests={props.pretests ?? []}
					exampleHtml={props.exampleHtml}
					onSubmit={props.sends ? props.onSubmit : undefined}
					sends={props.sends}
					runnerOrigin={props.runnerOrigin ?? null}
					value={typeof props.payload === "string" ? props.payload : null}
					onChange={(code, userEvent) => props.onChange(code, userEvent)}
				/>
			)}
		</Show>
	);
}

/// Every question that is not an MDQ `code` question being answered.
function EssayOrOtherField(props: AnswerFieldProps): JSX.Element {
	return (
		<Show
			when={
				props.code &&
				!props.readonly &&
				!props.review &&
				props.question.type === "essay"
					? props.code
					: undefined
			}
			fallback={
				<AnyQuestionView
					question={props.question}
					value={props.payload ?? null}
					onChange={props.onChange}
					mode={
						props.review ? "review" : props.readonly ? "readonly" : "answer"
					}
					result={props.review}
					hideScore
					messages={mdqMessages}
				/>
			}
		>
			{(code) => (
				<CodeEssayAnswer
					stem={props.question.type === "essay" ? props.question.stem : ""}
					epilogue={
						props.question.type === "essay"
							? props.question.epilogue
							: undefined
					}
					language={code().language}
					value={code().value}
					valueSavedAt={code().valueSavedAt}
					clockOffsetMs={code().clockOffsetMs}
					onChange={props.onChange}
					save={code().save}
					codeRun={code().codeRun}
					runnerOrigin={code().runnerOrigin}
					draft={code().draft}
					onConflict={code().onConflict}
					keepDraft={code().keepDraft}
				/>
			)}
		</Show>
	);
}
