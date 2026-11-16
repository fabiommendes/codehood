import { locale } from "@/i18n";

/// A part of the total as points out of 100, up to one decimal: `15`, `7.5`.
export function formatPoints(share: number): string {
	return (share * 100).toLocaleString(locale, { maximumFractionDigits: 1 });
}

/**
 * The points out of 100 each question carries, formatted, in the order of `questions`.
 *
 * @example
 * pointsByPosition([{ weight: 3 }, { weight: 1 }]) // ["75", "25"]
 */
export function pointsByPosition(questions: { weight: number }[]): string[] {
	const total = questions.reduce((sum, { weight }) => sum + weight, 0);
	return questions.map(({ weight }) =>
		formatPoints(total > 0 ? weight / total : 0),
	);
}
