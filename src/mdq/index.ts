/**
 * The MDQ questions this server hosts, on top of the `mdq` library.
 *
 * Documents, public forms, responses and scores all follow the mdq spec; this
 * module only adds the few checks a service needs before writing.
 */
import {
	type Diagnostic,
	type PublicQuestion as MdqPublicQuestion,
	publicForm as mdqPublicForm,
	modelDiagnostics,
	NotAutoGradable,
	Question,
	scoreResponse,
} from "mdq";

export type {
	BlankScore,
	ChoiceBlank,
	Diagnostic,
	EssayQuestion,
	FillInQuestion,
	FillInResponse,
	MultipleChoiceQuestion,
	MultipleChoiceResponse,
	MultipleSelectionQuestion,
	MultipleSelectionResponse,
	NumericBlank,
	NumericQuestion,
	NumericResponse,
	OrderingLine,
	OrderingQuestion,
	OrderingResponse,
	PublicBlank,
	PublicChoice,
	PublicEssayQuestion,
	PublicFillInQuestion,
	PublicMultipleChoiceQuestion,
	PublicMultipleSelectionQuestion,
	PublicNumericQuestion,
	PublicOrderingQuestion,
	PublicShortAnswerQuestion,
	PublicTrueFalseQuestion,
	QuestionResponse,
	QuestionScore,
	ShortAnswerBlank,
	ShortAnswerQuestion,
	TextResponse,
	TrueFalseQuestion,
	TrueFalseResponse,
} from "mdq";
export {
	combineBlanks,
	correctResponses,
	MissingIdError,
	NotAutoGradable,
	ResponseError,
	scoreBlanks,
	scoreResponse,
	withIds,
} from "mdq";

/// The mdq types this server cannot host yet: no answer UI, runner report or grading for them.
export const UNSUPPORTED_QUESTION_TYPES = ["code"] as const;

/** A question document of a type this server hosts, which is every mdq type but `code`. */
export type QuestionDocument = Exclude<
	Question,
	{ type: (typeof UNSUPPORTED_QUESTION_TYPES)[number] }
>;

/** The message of the validation error that refuses a question of an unsupported type. */
export const UNSUPPORTED_TYPE_MESSAGE =
	'Question type "code" is not supported yet.';

/**
 * Validates a question document of any hosted type and refuses an mdq type this
 * server cannot grade, so none is ever stored.
 */
export const questionDocument = Question.refine(
	(question): question is QuestionDocument =>
		!(UNSUPPORTED_QUESTION_TYPES as readonly string[]).includes(question.type),
	{ message: UNSUPPORTED_TYPE_MESSAGE, path: ["type"] },
);

/** The type of a question document. */
export type QuestionType = QuestionDocument["type"];

/** The public form of a question document. */
export type PublicQuestion = MdqPublicQuestion;

/// The public form of a hosted question, which is never a `code` one.
type HostedPublicQuestion = Exclude<PublicQuestion, { type: "code" }>;

/// The public form matching the type of `Q`, whichever hosted types `Q` covers.
type PublicFormOf<Q extends QuestionDocument> = Extract<
	HostedPublicQuestion,
	{ type: Q["type"] }
>;

/**
 * The public form of a question document, as mdq's `publicForm` but typed
 * without the `code` type, which this server refuses.
 */
export const publicForm = mdqPublicForm as <Q extends QuestionDocument>(
	question: Q,
) => PublicFormOf<Q>;

/**
 * The rules of the mdq spec that `question` breaks beyond its schema, such as a
 * fill-in stem naming a blank it never defines.
 */
export function questionProblems(question: QuestionDocument): Diagnostic[] {
	return modelDiagnostics(question).filter((d) => d.severity === "error");
}

/**
 * Checks that `response` is a well-formed response to `question`, or `null`
 * for a skipped question.
 *
 * A response that only an instructor can grade is well formed.
 *
 * @throws {ResponseError} If the response has the wrong shape or names a
 *   choice or blank the question does not have.
 */
export function assertResponse(
	question: QuestionDocument,
	response: unknown,
): void {
	if (response === null) return;
	try {
		scoreResponse(question, response);
	} catch (error) {
		if (!(error instanceof NotAutoGradable)) throw error;
	}
}
