import {
	type AnswerPayload,
	answersOf,
	blanksOf,
	choiceOf,
	choicesOf,
	essayOf,
	numberOf,
	textOf,
} from "@/components/exam/answer-payload";

/// How a saved answer is shown in its article.
export type AnswerDisplay =
	| { kind: "empty" }
	| { kind: "text"; text: string; multiline: boolean }
	| { kind: "blanks"; entries: [id: string, text: string][] }
	| { kind: "choices" };

/**
 * Decides how the answer to a question of `type` is shown.
 *
 * Text-entry answers become plain text, so the statement is not repeated for
 * each of them. A choice answer is shown by the question's own read-only view,
 * which marks the picks. An answer with nothing in it is `empty`.
 */
export function displayAnswer(
	type: string,
	payload: AnswerPayload | undefined,
): AnswerDisplay {
	switch (type) {
		case "short-answer":
			return plain(textOf(payload), false);
		case "essay":
			return plain(essayOf(payload), true);
		case "numeric": {
			const value = numberOf(payload);
			return value === null
				? { kind: "empty" }
				: { kind: "text", text: String(value), multiline: false };
		}
		case "fill-in": {
			const entries = Object.entries(blanksOf(payload)).filter(
				([, text]) => text.trim() !== "",
			);
			return entries.length === 0
				? { kind: "empty" }
				: { kind: "blanks", entries };
		}
		case "multiple-choice":
			return choiceOf(payload) === null
				? { kind: "empty" }
				: { kind: "choices" };
		case "multiple-selection":
			return choicesOf(payload).size === 0
				? { kind: "empty" }
				: { kind: "choices" };
		default:
			return answersOf(payload).size === 0
				? { kind: "empty" }
				: { kind: "choices" };
	}
}

/// A text answer, or `empty` when it holds only whitespace.
function plain(text: string, multiline: boolean): AnswerDisplay {
	return text.trim() === ""
		? { kind: "empty" }
		: { kind: "text", text, multiline };
}
