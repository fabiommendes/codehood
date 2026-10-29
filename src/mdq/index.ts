/**
 * The MDQ questions this server hosts, on top of the `mdq` library.
 *
 * Documents, public forms, responses and scores all follow the mdq spec; this
 * module only adds the few checks a service needs before writing.
 */
import {
	type Diagnostic,
	type PublicQuestion as MdqPublicQuestion,
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
	publicForm,
	ResponseError,
	scoreBlanks,
	scoreResponse,
	withIds,
} from "mdq";

/** A question document of any mdq type. */
export const questionDocument = Question;
export type QuestionDocument = Question;

/** The type of a question document. */
export type QuestionType = QuestionDocument["type"];

/** The public form of a question document. */
export type PublicQuestion = MdqPublicQuestion;

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
