import type * as schema from "./schemas-generated";

/**
 * One piece of a fill-in stem: a run of inline Markdown, or the spot where a
 * blank goes.
 */
export type FillInSegment =
	| { kind: "markdown"; text: string }
	| { kind: "blank"; id: string };

// The slug of `FillInBlankIdSchema`, wrapped in the `[^…]` marker. Anything
// between brackets that does not match is not a reference and stays in the
// Markdown, which is what makes `[^1]` and `[not a slug]` harmless.
const REFERENCE = /\[\^([a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*)\]/g;

/**
 * Split a fill-in stem into the text around its blanks and the blanks
 * themselves.
 *
 * The split happens before anything reaches `markdown-it`, never after:
 * `[^foo]` is CommonMark's footnote syntax, and the day the footnote plugin is
 * switched on a stem parsed from rendered HTML would come apart. The cost is
 * that Markdown cannot span a blank — `**bold [^x] bold**` is two fragments
 * with unbalanced delimiters — which
 * `dev/specs/to-do/question-fill-in.md` declares unsupported, as mdq.spec's own
 * grammar reads it.
 */
export function parseFillInStem(stem: string): FillInSegment[] {
	const segments: FillInSegment[] = [];
	let cursor = 0;

	for (const match of stem.matchAll(REFERENCE)) {
		const start = match.index;
		if (start > cursor) {
			segments.push({ kind: "markdown", text: stem.slice(cursor, start) });
		}
		segments.push({ kind: "blank", id: match[1] });
		cursor = start + match[0].length;
	}

	if (cursor < stem.length) {
		segments.push({ kind: "markdown", text: stem.slice(cursor) });
	}

	return segments;
}

/**
 * The blanks the stem actually references, in the order they are declared.
 *
 * The schema cannot express the cross-reference — `blanks` is a list and the
 * stem is a string — so a blank nothing refers to is representable. It is
 * dropped here rather than rendered nowhere and graded anyway: a student
 * cannot answer a control that was never drawn, and charging them for it would
 * be charging them for the author's typo. The mirror case, a reference with no
 * blank, is left in the stem as literal text by `parseFillInStem`.
 */
export function fillInBlanks(
	question: Pick<schema.FillIn, "stem" | "blanks">,
): schema.FillInBlank[] {
	const referenced = new Set(
		parseFillInStem(question.stem).flatMap((segment) =>
			segment.kind === "blank" ? [segment.id] : [],
		),
	);

	return question.blanks.filter((blank) => referenced.has(blank.id));
}

/**
 * The patterns a short-answer blank accepts.
 *
 * `regex` replaces `oneOf` rather than joining it, which is what the blank's
 * own docstring says and the opposite of what the standalone `ShortAnswer.regex`
 * does. Two rules for one field name; the one describing this field wins here,
 * and the disagreement is flagged upstream.
 */
export function blankPatterns(
	blank: Pick<schema.FillInShortAnswerBlank, "oneOf" | "regex">,
): string[] {
	if (blank.regex !== undefined) return [`/${blank.regex}/`];
	return blank.oneOf ?? [];
}
