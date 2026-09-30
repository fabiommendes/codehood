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

/// Whether answers of this type are typed, so saving waits for a pause rather than happening at once.
export function isTextEntry(type: string): boolean {
	return (
		type === "short-answer" ||
		type === "essay" ||
		type === "numeric" ||
		type === "fill-in"
	);
}

/** Whether a payload holds an answer: a pick, a verdict, or some non-blank text. */
export function isAnswered(payload: AnswerPayload | undefined): boolean {
	if (!payload) return false;
	if ("choice" in payload) return payload.choice !== "";
	if ("choices" in payload) return payload.choices.length > 0;
	if ("answers" in payload) return Object.keys(payload.answers).length > 0;
	if ("value" in payload) return payload.value !== null;
	if ("text" in payload) return payload.text.trim() !== "";
	if ("essay" in payload) return payload.essay.trim() !== "";
	return Object.values(payload.blanks).some((blank) => blank.trim() !== "");
}
