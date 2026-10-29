import { type Accessor, type JSX, Match, Switch } from "solid-js";
import type { ExamQuestionRow } from "@/components/exam/ExamQuestionsList";
import { AnyQuestionView, mdqMessages } from "@/components/question/mdq";
import QuestionPreview, {
	type PreviewTab,
} from "@/components/question/QuestionPreview";
import { publicForm } from "@/mdq";

export interface ExamQuestionProps {
	/** The pinned version of the question, answer key included. */
	question: ExamQuestionRow;
	/**
	 * Drives every pinned question's student/key toggle from one shared
	 * control instead of each carrying its own — see `ExamQuestionsList`.
	 */
	tab: Accessor<PreviewTab>;
}

/**
 * One of an exam's pinned questions as staff see it on the exam page: the
 * question's own frozen view, or the answer key.
 *
 * The key tab reuses `QuestionPreview` whole, the toggle the question's own
 * detail page already offers. The student tab renders the public form in
 * `readonly` mode: a frozen look at the question, nothing to interact with.
 */
export default function ExamQuestion(props: ExamQuestionProps): JSX.Element {
	return (
		<Switch>
			<Match when={props.tab() === "key"}>
				<QuestionPreview data={props.question.question} tab={props.tab} />
			</Match>
			<Match when={props.tab() === "student"}>
				<AnyQuestionView
					question={publicForm(props.question.question)}
					mode="readonly"
					messages={mdqMessages}
				/>
			</Match>
		</Switch>
	);
}
