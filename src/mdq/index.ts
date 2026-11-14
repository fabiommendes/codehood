/**
 * The MDQ questions this server hosts, on top of the `mdq` library.
 *
 * Documents, public forms, responses and scores all follow the mdq spec; this
 * module only adds the few checks a service needs before writing.
 */

import {
	attachmentFieldRules,
	type CodeQuestion,
	checkUniqueAttachmentNames,
	type Diagnostic,
	type PublicQuestion as MdqPublicQuestion,
	publicForm as mdqPublicForm,
	modelDiagnostics,
	NotAutoGradable,
	parseTextResponse,
	Question,
	scoreResponse,
} from "mdq";
import { elmModule } from "@/components/runner/test-report";
import {
	ElmExamplesError,
	elmAnswerModule,
	elmExampleCases,
} from "@/services/elm-examples";

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

/**
 * The rules of the mdq spec that a list of attachments breaks beyond its
 * schema: duplicate names, and a name or format that disagrees with the origin.
 */
export function attachmentProblems(attachments: unknown): Diagnostic[] {
	const duplicate = checkUniqueAttachmentNames(attachments);
	return [
		...attachmentFieldRules(attachments),
		...(duplicate ? [duplicate] : []),
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
	return [...problems, ...elmTestSourceProblems(question)];
}

/**
 * The author mistakes of the test sources of an Elm question: an invalid
 * examples block, a linked source with no `module` header, and an `Examples<i>`
 * module that collides with the answer module or with another source's module.
 *
 * Syntax only, and a source with no text is skipped.
 */
export function elmTestSourceProblems(question: CodeQuestion): Diagnostic[] {
	if (question.language !== "elm" || question.file === undefined) return [];
	const sources = (question.tests ?? []).flatMap((source, index) =>
		source.format === "elm" && source.text !== undefined
			? [{ index, text: source.text, linked: source.origin !== undefined }]
			: [],
	);
	const answer = elmAnswerModule(question.file);
	const problems: Diagnostic[] = [];
	const report = (code: string, index: number, message: string) =>
		problems.push({
			severity: "error",
			code,
			message: `tests[${index}]: ${message}`,
			path: ["tests", index],
		});
	for (const { index, text, linked } of sources) {
		if (elmModule(text) !== null) continue;
		if (linked) {
			report(
				"elm-test-source-without-module",
				index,
				"a linked Elm source needs a `module` header",
			);
			continue;
		}
		try {
			elmExampleCases(text);
		} catch (error) {
			if (!(error instanceof ElmExamplesError)) throw error;
			report("invalid-elm-examples", index, error.message);
			continue;
		}
		const name = `Examples${index}`;
		const other = sources.find(
			(source) => source.index !== index && elmModule(source.text) === name,
		);
		if (name === answer || other) {
			const target = other
				? `the module of tests[${other.index}]`
				: "the answer module";
			report(
				"elm-module-collision",
				index,
				`the generated module ${name} collides with ${target}`,
			);
		}
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
