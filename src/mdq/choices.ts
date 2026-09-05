/**
 * Resolve the stable id of every choice in a list, in order.
 *
 * `id` is optional in the schema, but answers travel as ids rather than
 * positions (see `dev/specs/to-review/questions.md`, "Options carry stable
 * ids"), so scoring and the public representation must agree on the same
 * fallback or a student's answer addresses a choice the grader cannot find.
 * The fallback slugifies the choice text, which mdq.spec asks to stay stable
 * across reordering, insertion and removal; a text that slugifies to nothing
 * or collides with an id already in use falls back to its 1-based position.
 */
export function resolveChoiceIds(
	choices: readonly { id?: string; text: string }[],
): string[] {
	const taken = new Set(
		choices.map((choice) => choice.id).filter((id) => id !== undefined),
	);
	const ids: string[] = [];

	for (const [index, choice] of choices.entries()) {
		if (choice.id !== undefined) {
			ids.push(choice.id);
			continue;
		}
		const slug = slugifyChoice(choice.text);
		const id = slug && !taken.has(slug) ? slug : `${index + 1}`;
		taken.add(id);
		ids.push(id);
	}

	return ids;
}

/** Lowercase, hyphenated, url-safe token, or the empty string when nothing survives. */
function slugifyChoice(text: string): string {
	return text
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "") // strip diacritics after NFKD decomposition
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
