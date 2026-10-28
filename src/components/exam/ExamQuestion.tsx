import { type Accessor, type JSX, Match, Switch } from "solid-js";
import type { ExamQuestionRow } from "@/components/exam/ExamQuestionsList";
import { AnyQuestionView, mdqMessages } from "@/components/question/mdq";
import QuestionPreview, {
	type PreviewTab,
} from "@/components/question/QuestionPreview";
import type { QuestionPublic } from "@/db";
import { type PublicQuestion, publicForm, type QuestionDocument } from "@/mdq";

export interface ExamQuestionProps {
	/** The pinned version of the question, as `question.service` handed it back. */
	question: ExamQuestionRow;
	/** Whoever may write the course's contents also sees the answer key. */
	canManage: boolean;
	/**
	 * Drives every pinned question's student/key toggle from one shared
	 * control instead of each carrying its own — see `ExamQuestionsList`.
	 * Ignored when `canManage` is false; a student's view has no such toggle.
	 */
	tab?: Accessor<PreviewTab>;
}

/**
 * One of an exam's pinned questions, inlined into the exam page.
 *
 * The same component serves both actors, switched on `canManage` rather than
 * on the shape of `question` itself: an instructor's `question` carries the
 * full authored document, so it reuses `QuestionPreview` whole — the
 * student/key toggle the question's own detail page already offers. A
 * student's `question` was fetched with `public: true` and never held more
 * than the public form in the first place (see `question.service`), so it
 * goes straight to the question's view in `readonly` mode: a frozen look at
 * the question, no answer key, nothing to interact with here.
 */
export default function ExamQuestion(props: ExamQuestionProps): JSX.Element {
	return (
		<Switch>
			<Match when={props.canManage && props.tab?.() === "key"}>
				<QuestionPreview
					data={props.question.question as QuestionDocument}
					tab={props.tab}
				/>
			</Match>
			<Match when={props.canManage}>
				<PublicQuestionView
					question={
						publicForm(
							props.question.question as QuestionDocument,
						) as PublicQuestion
					}
				/>
			</Match>
			<Match when={!props.canManage}>
				<PublicQuestionView
					question={props.question.question as QuestionPublic["question"]}
				/>
			</Match>
		</Switch>
	);
}

interface PublicQuestionViewProps {
	question: QuestionPublic["question"];
}

/** The frozen, no-answer-key rendering of a question's public form. */
function PublicQuestionView(props: PublicQuestionViewProps): JSX.Element {
	return (
		<AnyQuestionView
			question={props.question}
			mode="readonly"
			messages={mdqMessages}
		/>
	);
}
