/**
 * The JSON a student's answer is stored as, one shape per question type.
 *
 * These mirror the answer types in `src/mdq/scoring.ts`, with `Set` and `Map`
 * spelled as an array and a plain object so the payload survives JSON.
 */
export type AnswerPayload =
	| { choice: string }
	| { choices: string[] }
	| { answers: Record<string, boolean> }
	| { value: number | null }
	| { text: string }
	| { essay: string }
	| { blanks: Record<string, string> };

/** The chosen choice id of a multiple-choice payload, or `null` when unanswered. */
export function choiceOf(payload: AnswerPayload | undefined): string | null {
	return payload && "choice" in payload ? payload.choice : null;
}

/** The ticked choice ids of a multiple-selection payload. */
export function choicesOf(payload: AnswerPayload | undefined): Set<string> {
	return new Set(payload && "choices" in payload ? payload.choices : []);
}

/** The statement verdicts of a true/false payload. */
export function answersOf(
	payload: AnswerPayload | undefined,
): Map<string, boolean> {
	return new Map(
		Object.entries(payload && "answers" in payload ? payload.answers : {}),
	);
}

/** The number of a numeric payload, or `null` when unanswered. */
export function numberOf(payload: AnswerPayload | undefined): number | null {
	return payload && "value" in payload ? payload.value : null;
}

/** The text of a short-answer payload. */
export function textOf(payload: AnswerPayload | undefined): string {
	return payload && "text" in payload ? payload.text : "";
}

/** The text of an essay payload. */
export function essayOf(payload: AnswerPayload | undefined): string {
	return payload && "essay" in payload ? payload.essay : "";
}

/** The blank contents of a fill-in payload, keyed by blank id. */
export function blanksOf(
	payload: AnswerPayload | undefined,
): Record<string, string> {
	return payload && "blanks" in payload ? payload.blanks : {};
}

/** A multiple-selection payload from the ticked choice ids. */
export function fromChoices(choices: ReadonlySet<string>): AnswerPayload {
	return { choices: [...choices] };
}

/** A true/false payload from the statement verdicts. */
export function fromAnswers(
	answers: ReadonlyMap<string, boolean>,
): AnswerPayload {
	return { answers: Object.fromEntries(answers) };
}

/// Whether editing a question of this type is a discrete pick, saved at once rather than debounced.
export function isTextEntry(type: string): boolean {
	return (
		type === "short-answer" ||
		type === "essay" ||
		type === "numeric" ||
		type === "fill-in"
	);
}
