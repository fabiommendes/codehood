/// Kept free of imports so browser code can read a score without pulling in the schemas.

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
