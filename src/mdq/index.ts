/**
 * The MDQ questions this server hosts, on top of the `mdq` library.
 *
 * Documents, public forms, responses and scores all follow the mdq spec; this
 * module only adds the few checks a service needs before writing.
 */
import {
	type CodeQuestion,
	type Diagnostic,
	type PublicQuestion as MdqPublicQuestion,
	publicForm as mdqPublicForm,
	modelDiagnostics,
	NotAutoGradable,
	parseTextResponse,
	Question,
	scoreResponse,
} from "mdq";

export type {
	BlankScore,
	ChoiceBlank,
	CodeQuestion,
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
	PublicCodeQuestion,
	PublicEssayQuestion,
	PublicFillInQuestion,
	PublicMultipleChoiceQuestion,
	PublicMultipleSelectionQuestion,
	PublicNumericQuestion,
	PublicOrderingQuestion,
	PublicShortAnswerQuestion,
	PublicTest,
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

/** A question document of any mdq type. */
export const questionDocument = Question;

/** A question document of any mdq type. */
export type QuestionDocument = Question;

/** The type of a question document. */
export type QuestionType = QuestionDocument["type"];

/** The public form of a question document. */
export type PublicQuestion = MdqPublicQuestion;

/** The public form of a question document, as mdq's `publicForm`. */
export const publicForm = mdqPublicForm;

/**
 * The rules of the mdq spec that `question` breaks beyond its schema, such as a
 * fill-in stem naming a blank it never defines.
 */
export function questionProblems(question: QuestionDocument): Diagnostic[] {
	return [
		...modelDiagnostics(question).filter((d) => d.severity === "error"),
		...(question.type === "code" ? codeProblems(question) : []),
	];
}

/// What this server demands of a code question beyond the mdq model rules: resolved test sources and no manual item that counts.
function codeProblems(question: CodeQuestion): Diagnostic[] {
	const problems: Diagnostic[] = [];
	for (const [index, source] of (question.tests ?? []).entries()) {
		if (source.text !== undefined) continue;
		problems.push({
			severity: "error",
			code: "unresolved-test-source",
			message: `tests[${index}] (${source.origin ?? source.format}) is not resolved: it has no text`,
			path: ["tests", index],
		});
	}
	for (const [index, item] of (question.rubric ?? []).entries()) {
		if ((item.value ?? 1) === 0) continue;
		problems.push({
			severity: "error",
			code: "manual-rubric-item-with-value",
			message: `rubric[${index}] is a manual item worth ${item.value ?? 1}, but only manual items worth 0 are accepted`,
			path: ["rubric", index],
		});
	}
	return problems;
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
	// A code response is the content of the file; the grading is not the server's.
	if (question.type === "code") {
		parseTextResponse(response);
		return;
	}
	try {
		scoreResponse(question, response);
	} catch (error) {
		if (!(error instanceof NotAutoGradable)) throw error;
	}
}
