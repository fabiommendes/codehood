import {
	en,
	type Messages,
	ptBR,
	type QuestionMode,
	QuestionView,
} from "mdq/solid";
import type { JSX } from "solid-js";
import { locale, m } from "@/i18n";
import type { BlankScore, PublicQuestion, QuestionScore } from "@/mdq";

/// The strings of the `mdq/solid` components in the locale of this installation.
export const mdqMessages: Messages = {
	...(locale === "pt-BR" ? ptBR : en),
	score: (value) => m.questions_score({ score: value }),
};

/// The correct responses of a question as a view takes them.
type CorrectResponses =
	| readonly unknown[]
	| Readonly<Record<string, readonly unknown[]>>;

/** The props of {@link AnyQuestionView}. */
export interface AnyQuestionViewProps {
	question: PublicQuestion;
	/// A response to `question`, as mdq `docs/responses.md` defines it.
	value?: unknown;
	onChange?: (response: never) => void;
	mode?: QuestionMode;
	hideScore?: boolean;
	/// `correct` is a list of correct responses, or the correct responses per blank of a fill-in question.
	result?:
		| (QuestionScore & { correct?: CorrectResponses })
		| {
				pending: true;
				blanks?: Record<string, BlankScore | null>;
				correct?: CorrectResponses;
		  };
	messages?: Partial<Messages>;
}

/**
 * The `QuestionView` of `mdq/solid` for a question and response whose types
 * only agree at runtime, such as a stored question and the stored answer to it.
 */
export const AnyQuestionView = QuestionView as unknown as (
	props: AnyQuestionViewProps,
) => JSX.Element;
