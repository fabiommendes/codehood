import { parseFillInStem } from "./fill-in";
import type * as schema from "./schemas-generated";

/**
 * Something wrong with a question that its schema cannot express.
 *
 * `code` is what a caller branches on and what a linter would report; `message`
 * is written for the author who has to fix the document.
 */
export interface QuestionProblem {
	code: string;
	message: string;
}

/**
 * Everything wrong with a question, or an empty list when it is well formed.
 *
 * The Zod schemas in `schemas-generated.ts` check one field at a time, which is
 * all JSON Schema can express. mdq.spec also states rules *between* fields —
 * fill-in's blanks and the references in its stem have to agree — and those are
 * checked here. Both halves have to pass before a question is stored: a
 * document that violates one of these is a question nobody can answer, and it
 * should be refused at the door rather than rendered into a broken exam.
 *
 * Returns a list rather than throwing on the first problem, because an author
 * fixing a document wants to see all of them at once.
 */
export function validateQuestion(data: schema.Question): QuestionProblem[] {
	return data.type === "fill-in" ? validateFillIn(data) : [];
}

/**
 * The four rules mdq.spec states for fill-in and JSON Schema cannot.
 *
 * Three of them are about the stem and the blanks agreeing: mdq.spec requires
 * that every blank definition's slug "MUST be present in the stem", the stem's
 * grammar (`item : inline_md? (ref inline_md?)+`) admits nothing but a
 * reference to a defined blank, and a blank id "MUST be unique within the
 * question". The fourth follows from the same grammar: a fill-in question with
 * no reference at all has no blank to fill in.
 */
function validateFillIn(data: schema.FillIn): QuestionProblem[] {
	const problems: QuestionProblem[] = [];

	const referenced = parseFillInStem(data.stem).flatMap((segment) =>
		segment.kind === "blank" ? [segment.id] : [],
	);
	const defined = data.blanks.map((blank) => blank.id);

	if (referenced.length === 0) {
		problems.push({
			code: "fill-in-stem-has-no-blank",
			message:
				"The stem of a fill-in question must reference at least one blank, as in `[^capital]`.",
		});
	}

	const duplicates = defined.filter(
		(id, index) => defined.indexOf(id) !== index,
	);
	for (const id of new Set(duplicates)) {
		problems.push({
			code: "fill-in-duplicate-blank",
			message: `More than one blank is called "${id}". Blank ids must be unique within a question.`,
		});
	}

	const definedIds = new Set(defined);
	for (const id of new Set(referenced)) {
		if (!definedIds.has(id)) {
			problems.push({
				code: "fill-in-undefined-blank",
				message: `The stem references [^${id}], but the question defines no blank with that id.`,
			});
		}
	}

	const referencedIds = new Set(referenced);
	for (const id of definedIds) {
		if (!referencedIds.has(id)) {
			problems.push({
				code: "fill-in-unreferenced-blank",
				message: `The blank "${id}" is never referenced by the stem, so nothing would draw it.`,
			});
		}
	}

	return problems;
}
