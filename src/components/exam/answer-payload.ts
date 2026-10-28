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
 * Whether the payload of a question of `type` holds an answer: a pick, a
 * verdict, a number, or some non-blank text.
 */
export function isAnswered(
	type: string,
	payload: AnswerPayload | undefined,
): boolean {
	if (payload === undefined || payload === null) return false;
	if (typeof payload === "string") return payload.trim() !== "";
	if (typeof payload === "number" || type === "numeric") return true;
	if (Array.isArray(payload)) return payload.length > 0;
	return Object.values(payload).some((entry) => entry !== null && entry !== "");
}
