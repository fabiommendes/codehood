import type { JSX } from "solid-js";
import { Match, Switch } from "solid-js";
import Alert from "@/components/ui/Alert";
import type {
	PublicEssay,
	PublicMultipleChoice,
	PublicMultipleSelection,
	PublicNumeric,
	PublicShortAnswer,
	PublicTrueFalse,
} from "@/mdq/public";
import EssayView, { type EssayViewProps } from "./EssayView";
import MultipleChoiceView, {
	type MultipleChoiceViewProps,
} from "./MultipleChoiceView";
import MultipleSelectionView, {
	type MultipleSelectionViewProps,
} from "./MultipleSelectionView";
import NumericView, { type NumericViewProps } from "./NumericView";
import ShortAnswerView, { type ShortAnswerViewProps } from "./ShortAnswerView";
import TrueFalseView, { type TrueFalseViewProps } from "./TrueFalseView";

// A discriminated union rather than "props for the union of question types":
// the four view prop types disagree on `value`, `onChange` and `result`, so a
// single flattened prop bag could not tell the caller which shape applies to
// which `question`.
export type QuestionViewProps =
	| ({ question: PublicEssay } & Omit<EssayViewProps, "question">)
	| ({ question: PublicNumeric } & Omit<NumericViewProps, "question">)
	| ({ question: PublicShortAnswer } & Omit<ShortAnswerViewProps, "question">)
	| ({ question: PublicMultipleChoice } & Omit<
			MultipleChoiceViewProps,
			"question"
	  >)
	| ({ question: PublicMultipleSelection } & Omit<
			MultipleSelectionViewProps,
			"question"
	  >)
	| ({ question: PublicTrueFalse } & Omit<TrueFalseViewProps, "question">);

type EssayProps = Extract<QuestionViewProps, { question: PublicEssay }>;
type NumericProps = Extract<QuestionViewProps, { question: PublicNumeric }>;
type ShortAnswerProps = Extract<
	QuestionViewProps,
	{ question: PublicShortAnswer }
>;
type ChoiceProps = Extract<
	QuestionViewProps,
	{ question: PublicMultipleChoice }
>;
type SelectionProps = Extract<
	QuestionViewProps,
	{ question: PublicMultipleSelection }
>;
type TrueFalseProps = Extract<QuestionViewProps, { question: PublicTrueFalse }>;

/**
 * Dispatches on `question.type` to the component that renders it, so a page
 * showing a mix of question types does not need its own switch statement.
 *
 * Only `fill-in` has no renderer today. It falls back to a named "not yet
 * implemented" alert rather than a blank space, which keeps the dispatcher
 * honest about what it can grow into.
 */
export default function QuestionView(props: QuestionViewProps): JSX.Element {
	return (
		<Switch
			fallback={
				<Alert variant="warning">
					Rendering for "{props.question.type}" questions is not implemented
					yet.
				</Alert>
			}
		>
			{/*
			 * TypeScript cannot narrow a union by a nested discriminant, so each
			 * arm asserts the shape its own `when` has already proved. The spread
			 * stays reactive: `props` is Solid's proxy either way.
			 */}
			<Match when={props.question.type === "essay"}>
				<EssayView {...(props as EssayProps)} />
			</Match>
			<Match when={props.question.type === "numeric"}>
				<NumericView {...(props as NumericProps)} />
			</Match>
			<Match when={props.question.type === "short-answer"}>
				<ShortAnswerView {...(props as ShortAnswerProps)} />
			</Match>
			<Match when={props.question.type === "multiple-choice"}>
				<MultipleChoiceView {...(props as ChoiceProps)} />
			</Match>
			<Match when={props.question.type === "multiple-selection"}>
				<MultipleSelectionView {...(props as SelectionProps)} />
			</Match>
			<Match when={props.question.type === "true-false"}>
				<TrueFalseView {...(props as TrueFalseProps)} />
			</Match>
		</Switch>
	);
}
