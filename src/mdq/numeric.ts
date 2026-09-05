import type * as schema from "./schemas-generated";

/**
 * Read what a student typed into a numeric box as a number, accepting the
 * `a/b` spelling alongside the usual decimal ones.
 *
 * mdq.spec's numeric grammar admits fractions, so a question whose domain is
 * `fraction` has to accept one typed back — which a number input cannot do,
 * making this the view's parser as well as the format's. Anything
 * unparseable, an empty box included, is `null` rather than `NaN`: a response
 * nobody can interpret is not a wrong number, it is no number, and `NaN` would
 * compare false to itself all the way down to the grader.
 */
export function parseNumericInput(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed === "") return null;

	const fraction = trimmed.match(/^([+-]?\d+)\s*\/\s*(\d+)$/);
	if (fraction) {
		const denominator = Number(fraction[2]);
		if (denominator === 0) return null;
		return Number(fraction[1]) / denominator;
	}

	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/** Spell a number for a numeric input box, with an absent one as an empty box. */
export function formatNumericInput(value: number | null): string {
	return value === null ? "" : String(value);
}

/**
 * Whether a submitted number is close enough to a declared answer.
 *
 * The two tolerances are alternatives, not conditions: mdq.spec accepts a
 * response that passes either. With neither declared the absolute tolerance is
 * 0, which makes the test exact equality.
 *
 * The relative test is written as a multiplication rather than the division
 * the schema's docstring uses, because the division is undefined for a
 * question whose answer is 0 and the two agree everywhere else.
 *
 * Takes the two fields rather than a whole question so a fill-in's numeric
 * blank, which is a `Numeric` with the question parts cut away, can be graded
 * by the same rule.
 */
export function withinTolerance(
	value: number,
	question: Pick<schema.Numeric, "answer" | "tolerance">,
): boolean {
	const error = Math.abs(value - question.answer);
	const { absolute = 0, relative } = question.tolerance ?? {};

	if (error <= absolute) return true;
	return (
		relative !== undefined && error <= Math.abs(question.answer) * relative
	);
}
