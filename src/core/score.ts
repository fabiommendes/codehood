/// Kept free of the schemas so browser code can read a score without pulling them in.

import { m } from "@/i18n";

/** The numeric value of a score string, or `null` when the denominator is zero. */
export function scoreValue(text: string): number | null {
	const negative = text.startsWith("-");
	const digits = negative ? text.slice(1) : text;
	const slashAt = digits.indexOf("/");

	let magnitude: number;
	if (slashAt < 0) {
		magnitude = Number(digits);
	} else {
		const denominator = Number(digits.slice(slashAt + 1));
		if (denominator === 0) return null;
		magnitude = Number(digits.slice(0, slashAt)) / denominator;
	}

	return negative ? -magnitude : magnitude;
}

/// What the grading form shows when the typed percentage is refused.
export const SCORE_ERROR = m.errors_score_whole_percent();

/** Whether `text` is a whole percentage from 0 to 100, surrounding whitespace aside. */
export function isPercentScore(text: string): boolean {
	const digits = text.trim();
	return /^[0-9]+$/.test(digits) && Number(digits) <= 100;
}
