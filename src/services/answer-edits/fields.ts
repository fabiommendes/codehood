/**
 * Which answer fields the edit history follows; free of server imports, so the
 * exam page and the history service share it.
 */

/**
 * Whether the edit history follows `field` of a question of `questionType`.
 *
 * The single place that decides which answers have a history: the `answer`
 * field of an essay, which includes code essays, and of a code question.
 *
 * @example
 * isHistoryField("essay", "answer"); // true
 * isHistoryField("code", "answer"); // true
 * isHistoryField("multiple-choice", "answer"); // false
 */
export function isHistoryField(
	questionType: string | undefined,
	field: string,
): boolean {
	return (
		field === "answer" && (questionType === "essay" || questionType === "code")
	);
}
