import { type Accessor, type JSX, Match, Switch } from "solid-js";
import type { ExamQuestionRow } from "@/components/exam/ExamQuestionsList";
import EssayView from "@/components/question/EssayView";
import FillInView from "@/components/question/FillInView";
import MultipleChoiceView from "@/components/question/MultipleChoiceView";
import MultipleSelectionView from "@/components/question/MultipleSelectionView";
import NumericView from "@/components/question/NumericView";
import QuestionPreview, {
	type PreviewTab,
} from "@/components/question/QuestionPreview";
import ShortAnswerView from "@/components/question/ShortAnswerView";
import TrueFalseView from "@/components/question/TrueFalseView";
import type { QuestionPublic } from "@/db";
import type {
	PublicEssay,
	PublicFillIn,
	PublicMultipleChoice,
	PublicMultipleSelection,
	PublicNumeric,
	PublicShortAnswer,
	PublicTrueFalse,
} from "@/mdq/public";
import type * as schema from "@/mdq/schemas-generated";

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
 * than the public half in the first place (see `question.service`'s
 * public/private split), so it dispatches straight to the type's own
 * `*View` in `readonly` mode: a frozen look at the question, no answer key,
 * nothing to interact with here.
 */
export default function ExamQuestion(props: ExamQuestionProps): JSX.Element {
	return (
		<Switch>
			<Match when={props.canManage}>
				<QuestionPreview
					data={props.question.question as schema.Question}
					tab={props.tab}
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

/** The frozen, no-answer-key rendering of a question's public half. */
function PublicQuestionView(props: PublicQuestionViewProps): JSX.Element {
	return (
		<Switch
			fallback={
				<p class="text-sm text-base-content/60">
					Preview for "{props.question.type}" questions is not implemented yet.
				</p>
			}
		>
			<Match when={props.question.type === "essay"}>
				<EssayView question={props.question as PublicEssay} mode="readonly" />
			</Match>
			<Match when={props.question.type === "numeric"}>
				<NumericView
					question={props.question as PublicNumeric}
					mode="readonly"
				/>
			</Match>
			<Match when={props.question.type === "short-answer"}>
				<ShortAnswerView
					question={props.question as PublicShortAnswer}
					mode="readonly"
				/>
			</Match>
			<Match when={props.question.type === "multiple-choice"}>
				<MultipleChoiceView
					question={props.question as PublicMultipleChoice}
					mode="readonly"
				/>
			</Match>
			<Match when={props.question.type === "multiple-selection"}>
				<MultipleSelectionView
					question={props.question as PublicMultipleSelection}
					mode="readonly"
				/>
			</Match>
			<Match when={props.question.type === "true-false"}>
				<TrueFalseView
					question={props.question as PublicTrueFalse}
					mode="readonly"
				/>
			</Match>
			<Match when={props.question.type === "fill-in"}>
				<FillInView question={props.question as PublicFillIn} mode="readonly" />
			</Match>
		</Switch>
	);
}
