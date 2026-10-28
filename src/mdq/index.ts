/**
 * The MDQ questions this server hosts, on top of the `mdq` library.
 *
 * Documents, public forms, responses and scores all follow the mdq spec; this
 * module only narrows the library to the question types the server stores and
 * adds the few checks a service needs before writing.
 */
import {
	type Diagnostic,
	EssayQuestion,
	FillInQuestion,
	type PublicQuestion as MdqPublicQuestion,
	type Question as MdqQuestion,
	MultipleChoiceQuestion,
	MultipleSelectionQuestion,
	modelDiagnostics,
	NotAutoGradable,
	NumericQuestion,
	type OrderingQuestion,
	type PublicOrderingQuestion,
	ShortAnswerQuestion,
	scoreResponse,
	TrueFalseQuestion,
} from "mdq";
import { z } from "zod";

export type {
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
	PublicBlank,
	PublicChoice,
	PublicEssayQuestion,
	PublicFillInQuestion,
	PublicMultipleChoiceQuestion,
	PublicMultipleSelectionQuestion,
	PublicNumericQuestion,
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
	correctResponses,
	MissingIdError,
	NotAutoGradable,
	publicForm,
	ResponseError,
	scoreBlanks,
	scoreResponse,
	withIds,
} from "mdq";

/** A question document of a type this server hosts: every mdq type but `ordering`. */
export const questionDocument = z.discriminatedUnion("type", [
	MultipleChoiceQuestion,
	MultipleSelectionQuestion,
	TrueFalseQuestion,
	NumericQuestion,
	ShortAnswerQuestion,
	EssayQuestion,
	FillInQuestion,
]);
export type QuestionDocument = Exclude<MdqQuestion, OrderingQuestion>;

/** The type of a hosted question document. */
export type QuestionType = QuestionDocument["type"];

/** The public form of a hosted question document. */
export type PublicQuestion = Exclude<MdqPublicQuestion, PublicOrderingQuestion>;

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
