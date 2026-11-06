import type { QuestionResponse } from "@/mdq";

/**
 * The JSON a student's answer is stored as: the response of mdq
 * `docs/responses.md`, or `null` for a question left unanswered.
 */
export type AnswerPayload = QuestionResponse | null;

/// Whether answers of this type are typed, so saving waits for a pause rather than happening at once.
export function isTextEntry(type: string): boolean {
	return (
		type === "short-answer" ||
		type === "essay" ||
		type === "numeric" ||
		type === "fill-in"
	);
}

/**
 * Whether the payload of a question of `type` holds an answer.
 *
 * Only `null` skips a question, as mdq `docs/responses.md` has it: an empty
 * selection or an abstention on every statement is an answer the student gave
 * after touching the question. Text that is blank, and a fill-in with every
 * blank empty, count as no answer, since nothing was written.
 */
export function isAnswered(
	type: string,
	payload: AnswerPayload | undefined,
): boolean {
	if (payload === undefined || payload === null) return false;
	if (typeof payload === "string") return payload.trim() !== "";
	if (
		type === "fill-in" &&
		typeof payload === "object" &&
		!Array.isArray(payload)
	) {
		return Object.values(payload).some(
			(entry) => entry !== null && entry !== "",
		);
	}
	return true;
}

/**
 * The payload saved for a change: `null` when it holds no answer.
 *
 * @example
 * toSaved("essay", "  ") // null
 * toSaved("multiple-selection", []) // []
 */
export function toSaved(type: string, payload: AnswerPayload): AnswerPayload {
	return isAnswered(type, payload) ? payload : null;
}
