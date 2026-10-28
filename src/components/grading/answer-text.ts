import {
	type AnswerPayload,
	isAnswered,
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
	if (!isAnswered(type, payload)) return { kind: "empty" };
	switch (type) {
		case "short-answer":
		case "essay":
		case "numeric":
			return {
				kind: "text",
				text: responseText(payload),
				multiline: type === "essay",
			};
		case "fill-in": {
			const blanks = (payload ?? {}) as Record<string, unknown>;
			const entries = Object.entries(blanks)
				.map(([id, value]): [string, string] => [id, responseText(value)])
				.filter(([, text]) => text.trim() !== "");
			return { kind: "blanks", entries };
		}
		default:
			return { kind: "choices" };
	}
}

/// A typed response as text: a string or number as is, a numeric response with its unit.
function responseText(response: unknown): string {
	if (typeof response === "string") return response;
	if (typeof response === "number") return String(response);
	if (response && typeof response === "object" && "value" in response) {
		const { value, unit } = response as { value: unknown; unit?: string };
		return unit ? `${value} ${unit}` : String(value);
	}
	return "";
}
