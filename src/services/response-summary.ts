/**
 * One-line summaries of a student's response, for lists where each answer takes a row.
 *
 * Pure: the caller hands in the question document and the stored payload.
 */

import { m } from "@/i18n";
import type { QuestionDocument } from "@/mdq";

/// The longest a summarized piece of text gets before it is cut with an ellipsis.
const MAX_TEXT = 50;

/// The mark of a statement left unjudged, and of a blank left empty.
const EMPTY_MARK = "–";

/// The mark of an ordering line that is not in the answer key.
const UNKNOWN_POSITION = "?";

/// A response as one short line, with the whole text when the line cuts it.
export interface ResponseSummary {
	text: string;
	/// The untruncated text, present only when `text` is shorter than it.
	title?: string;
}

/// A group of identical summaries and how many answers produced it.
export interface SummaryGroup extends ResponseSummary {
	count: number;
}

/** Text with the inline markdown marks dropped and whitespace collapsed. */
export function plain(markdown: string): string {
	return markdown
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[`*_~]/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

/// `text` cut to `MAX_TEXT` characters, with the whole text as the title when it was cut.
function truncated(text: string): ResponseSummary {
	return text.length > MAX_TEXT
		? { text: `${text.slice(0, MAX_TEXT - 1).trimEnd()}…`, title: text }
		: { text };
}

/// The letter of the choice at `index`: A to Z, then AA, AB and so on.
function letter(index: number): string {
	const head = index >= 26 ? letter(Math.floor(index / 26) - 1) : "";
	return head + String.fromCharCode(65 + (index % 26));
}

/// The id of each choice, in document order.
function choiceIds(choices: readonly { id?: string }[]): string[] {
	return choices.map((choice) => choice.id ?? "");
}

/// A numeric response as text: the value, then its unit when it has one.
function numericText(response: unknown): string {
	if (typeof response === "number" || typeof response === "string") {
		return String(response).trim();
	}
	if (response && typeof response === "object" && "value" in response) {
		const { value, unit } = response as { value: unknown; unit?: string };
		return unit ? `${value} ${unit}` : String(value);
	}
	return "";
}

/// The summary of one fill-in blank, in the form its own type takes.
function blankText(
	blank: Extract<QuestionDocument, { type: "fill-in" }>["blanks"][number],
	response: unknown,
): string {
	if (response === null || response === undefined) return EMPTY_MARK;
	if (blank.type === "multiple-choice") {
		if (typeof response !== "string" || response === "") return EMPTY_MARK;
		const choice = blank.choices.find((entry) => entry.id === response);
		return choice ? plain(choice.text) : m.grades_summary_removed();
	}
	const text =
		blank.type === "numeric"
			? numericText(response)
			: typeof response === "string"
				? response.trim()
				: "";
	return text === "" ? EMPTY_MARK : text;
}

/// The position of each response line in the key, one-based, `?` for a line the key lacks.
function orderingText(lines: readonly unknown[], response: unknown): string {
	if (!Array.isArray(response)) return m.grades_summary_blank();
	const same = (a: unknown, b: unknown) =>
		JSON.stringify(a) === JSON.stringify(b);
	const taken = new Set<number>();
	return response
		.map((line) => {
			const at = lines.findIndex(
				(entry, index) => !taken.has(index) && same(entry, line),
			);
			if (at < 0) return UNKNOWN_POSITION;
			taken.add(at);
			return String(at + 1);
		})
		.join(" ");
}

/**
 * Summarizes the response to an automatically graded question as one short line.
 *
 * Choices are lettered in document order, not in the order the student saw
 * them. A `null` payload is blank, and a choice id the question no longer has
 * is removed. Types with no short form (essay, code) fall back to their text.
 *
 * @example
 * responseSummary(trueFalse, { a: true, b: false, c: null }).text; // "T F –"
 */
export function responseSummary(
	question: QuestionDocument,
	payload: unknown,
): ResponseSummary {
	if (payload === null || payload === undefined) {
		return { text: m.grades_summary_blank() };
	}
	switch (question.type) {
		case "multiple-choice": {
			if (typeof payload !== "string" || payload === "") {
				return { text: m.grades_summary_blank() };
			}
			const at = choiceIds(question.choices).indexOf(payload);
			const choice = question.choices[at];
			if (!choice) return { text: m.grades_summary_removed() };
			const full = `${letter(at)}. ${plain(choice.text)}`;
			return truncated(full);
		}
		case "multiple-selection": {
			const ticked = new Set(Array.isArray(payload) ? payload : []);
			if (ticked.size === 0) return { text: m.grades_summary_none_selected() };
			const ids = choiceIds(question.choices);
			const letters = ids.flatMap((id, index) =>
				ticked.has(id) ? [letter(index)] : [],
			);
			const removed = [...ticked].some((id) => !ids.includes(id as string));
			if (removed) letters.push(m.grades_summary_removed());
			return { text: letters.join(", ") };
		}
		case "true-false": {
			const verdicts =
				typeof payload === "object" && !Array.isArray(payload)
					? (payload as Record<string, unknown>)
					: {};
			const marks = choiceIds(question.choices).map((id) =>
				verdicts[id] === true
					? m.grades_summary_true()
					: verdicts[id] === false
						? m.grades_summary_false()
						: EMPTY_MARK,
			);
			return { text: marks.join(" ") };
		}
		case "numeric": {
			const text = numericText(payload);
			return { text: text === "" ? m.grades_summary_blank() : text };
		}
		case "short-answer": {
			const text = typeof payload === "string" ? payload.trim() : "";
			return text === "" ? { text: m.grades_summary_blank() } : truncated(text);
		}
		case "fill-in": {
			const values =
				typeof payload === "object" && !Array.isArray(payload)
					? (payload as Record<string, unknown>)
					: {};
			const text = question.blanks
				.map((blank) => blankText(blank, values[blank.id]))
				.join(" · ");
			return truncated(text);
		}
		case "ordering":
			return { text: orderingText(question.lines, payload) };
		default:
			return typeof payload === "string" && payload.trim() !== ""
				? truncated(payload.trim())
				: { text: m.grades_summary_blank() };
	}
}

/**
 * Groups the answers that summarize alike, the largest group first.
 *
 * Groups of the same size keep the order in which their first answer appears.
 */
export function summaryGroups(
	question: QuestionDocument,
	payloads: readonly unknown[],
): SummaryGroup[] {
	const groups = new Map<string, SummaryGroup>();
	for (const payload of payloads) {
		const summary = responseSummary(question, payload);
		const key = summary.title ?? summary.text;
		const group = groups.get(key);
		if (group) group.count += 1;
		else groups.set(key, { ...summary, count: 1 });
	}
	return [...groups.values()].sort((a, b) => b.count - a.count);
}
