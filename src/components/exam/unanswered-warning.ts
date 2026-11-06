import { locale, m } from "@/i18n";

/// Past this many unanswered questions the submit warning gives only their count.
const LISTED_MAX = 5;

/**
 * Question numbers as their labels in a sentence-ready list, such as "Q1, Q4 and Q5".
 */
export function questionList(numbers: readonly number[]): string {
	const labels = numbers.map((number) =>
		m.exams_attempt_question_short({ number }),
	);
	return new Intl.ListFormat(locale, { type: "conjunction" }).format(labels);
}

/**
 * The submit dialog's warning about unanswered questions: it lists up to five of them and only counts more than that.
 *
 * @example
 * unansweredWarning([1, 4, 5]); // "Questions Q1, Q4 and Q5 were not answered."
 */
export function unansweredWarning(numbers: readonly number[]): string {
	if (numbers.length > LISTED_MAX) {
		return m.exams_attempt_submit_unanswered_count({ count: numbers.length });
	}
	return m.exams_attempt_submit_unanswered_list({
		count: numbers.length,
		numbers: questionList(numbers),
	});
}
