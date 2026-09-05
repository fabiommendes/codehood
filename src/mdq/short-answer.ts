import type * as schema from "./schemas-generated";

/**
 * One answer pattern, after its delimiters have been read.
 *
 * The delimiters are the whole point of the mini-language: a `patternString`
 * says how it wants to be compared, and everything downstream just asks.
 */
export type Pattern =
	| { kind: "wildcard" }
	| { kind: "regex"; source: string; flags: string }
	| { kind: "exact"; text: string }
	| { kind: "plain"; text: string };

/**
 * Read a pattern string, per mdq.spec's table: `/…/` is a regular expression,
 * backticks make an exact literal, a lone `*` matches everything, and anything
 * else is a plain literal compared inexactly.
 */
export function parsePattern(source: string): Pattern {
	const trimmed = source.trim();

	if (trimmed === "*") return { kind: "wildcard" };

	if (trimmed.startsWith("/")) {
		const end = trimmed.lastIndexOf("/");
		// A lone leading "/" closes nothing; it is a literal, not a regex.
		if (end > 0) {
			return {
				kind: "regex",
				source: trimmed.slice(1, end),
				flags: trimmed.slice(end + 1),
			};
		}
	}

	if (trimmed.startsWith("`") && trimmed.endsWith("`") && trimmed.length >= 2) {
		return { kind: "exact", text: trimmed.slice(1, -1) };
	}

	return { kind: "plain", text: trimmed };
}

/** Whether a response matches one pattern. */
export function matchesPattern(response: string, pattern: Pattern): boolean {
	switch (pattern.kind) {
		case "wildcard":
			return true;
		case "plain":
			return normalizePlain(response) === normalizePlain(pattern.text);
		case "exact":
			return normalizeExact(response) === normalizeExact(pattern.text);
		case "regex":
			return matchesRegex(response, pattern);
	}
}

/**
 * The comparison form of an inexactly matched string: NFC, lowercased, runs of
 * whitespace collapsed to one space, ends trimmed.
 *
 * NFC folds spellings no reader can tell apart. It deliberately does not strip
 * diacritics — mdq.spec is explicit that an inexact `Brasília` must not accept
 * `Brasilia`, because dropping an accent changes how a word is spelled rather
 * than how it is encoded.
 */
function normalizePlain(text: string): string {
	return text.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * The comparison form of an exactly matched string: ends trimmed, NFC, and
 * otherwise untouched.
 *
 * Trimming is not a weakening of "exact". A document has no way to *state*
 * that it wants a leading space — Markdown collapses runs of spaces, editors
 * strip trailing ones — so there is nothing there to match against. NFC is the
 * normalization mdq.spec offers, taken because whether an editor emits NFC or
 * NFD is not something an author controls.
 */
function normalizeExact(text: string): string {
	return text.trim().normalize("NFC");
}

/**
 * Apply a regex pattern, translating mdq.spec's anchoring and flags into
 * JavaScript's.
 *
 * mdq regexes are anchored at both ends, so `/abc/` is JavaScript's
 * `/^(?:abc)$/`. The non-capturing group is load-bearing rather than
 * decorative: without it `/a|b/` would mean "starts with a, or ends with b".
 * `f` drops both implicit anchors and `b` drops only the trailing one; an
 * anchor the author wrote survives either way, since it is inside the group.
 *
 * A pattern JavaScript cannot compile matches nothing. Grading a whole exam is
 * no place to throw over one malformed question.
 */
function matchesRegex(
	response: string,
	pattern: { source: string; flags: string },
): boolean {
	const flags = new Set(pattern.flags.split(""));
	const find = flags.has("f");
	const beginning = flags.has("b");

	const prefix = find ? "" : "^";
	const suffix = find || beginning ? "" : "$";

	let compiled: RegExp;
	try {
		compiled = new RegExp(
			`${prefix}(?:${pattern.source})${suffix}`,
			flags.has("i") ? "i" : "",
		);
	} catch {
		return false;
	}

	// `n` is the only flag that touches the strings rather than the match, and
	// it applies to both halves or it would compare unlike things.
	const subject = flags.has("n") ? response.normalize("NFC") : response;
	return compiled.test(subject);
}

/**
 * The pattern strings a question accepts, in the order they are tried.
 *
 * `accept` and `oneOf` are two spellings of the same list — the frontmatter
 * field and the body block — and mdq.spec says a document using both must let
 * the frontmatter win, so one replaces the other rather than joining it.
 * `regex` is a third spelling of a single accept pattern, so it always joins
 * whichever list won.
 */
export function acceptPatterns(
	question: schema.ShortAnswer,
): schema.ShortAnswerPattern[] {
	const listed = question.accept ?? question.oneOf ?? [];
	return question.regex === undefined
		? [...listed]
		: [...listed, `/${question.regex}/`];
}

/** The pattern strings a question rejects, or `undefined` when it lists none. */
export function rejectPatterns(
	question: schema.ShortAnswer,
): schema.ShortAnswerPattern[] | undefined {
	return question.reject;
}

/** The pattern string and the feedback of one entry, however it was written. */
export function patternParts(entry: schema.ShortAnswerPattern): {
	pattern: string;
	feedback?: string;
} {
	return typeof entry === "string" ? { pattern: entry } : entry;
}

/**
 * The first entry of a list that matches, or `undefined` when none does.
 *
 * The order is the order the author wrote, which mdq.spec makes significant
 * for feedback.
 */
export function firstMatch(
	response: string,
	entries: readonly schema.ShortAnswerPattern[],
): { pattern: string; feedback?: string } | undefined {
	return entries
		.map(patternParts)
		.find((entry) => matchesPattern(response, parsePattern(entry.pattern)));
}

/**
 * The feedback of the first matching entry that carries a message.
 *
 * Not the feedback of the first matching entry: a pattern that matches and
 * says nothing does not consume the response's chance at an explanation.
 */
export function matchedFeedback(
	response: string,
	entries: readonly schema.ShortAnswerPattern[],
): string | undefined {
	return entries
		.map(patternParts)
		.find(
			(entry) =>
				entry.feedback !== undefined &&
				matchesPattern(response, parsePattern(entry.pattern)),
		)?.feedback;
}

/** Why a response is not a well-formed submission, when it is not. */
export interface SubmissionWarning {
	/** The `feedback` of the pattern that flagged it, when it carries one. */
	feedback?: string;
}

/**
 * Pre-validate a response against `preAccept` and `preReject`.
 *
 * This never touches a score — mdq.spec makes both fields pre-submission
 * validators, so a system can warn a student before they commit. The
 * precedence is the inverse of grading's: a response matching both lists is
 * invalid, where a response matching both `accept` and `reject` is correct.
 *
 * Returns `undefined` when the response is fine, or when the question declares
 * no pre-validation at all.
 */
export function validateShortAnswer(
	response: string,
	question: Pick<schema.ShortAnswer, "preAccept" | "preReject">,
): SubmissionWarning | undefined {
	const rejected = question.preReject
		? firstMatch(response, question.preReject)
		: undefined;
	if (rejected) return { feedback: rejected.feedback };

	if (question.preAccept && !firstMatch(response, question.preAccept)) {
		return {};
	}

	return undefined;
}
