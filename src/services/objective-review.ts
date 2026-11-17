/**
 * The model of the objective grading page: the answers to one auto-graded question grouped for review.
 *
 * Pure: the caller hands in the question document and the counting answers.
 */

import { m } from "@/i18n";
import type { QuestionDocument } from "@/mdq";
import {
	examResult,
	type ResultPolicy,
	type WeightedQuestion,
} from "./exam-result";
import {
	type AnswerState,
	autoScoreOf,
	type GradingAttempt,
	type GradingFeedback,
	type GradingPass,
	isManualChange,
} from "./grading";
import { discriminationFlag, type QuestionStats } from "./question-stats";
import { plain, responseSummary } from "./response-summary";
import { reviewResult } from "./review";

/// The fewest students a group needs for its mean on the other questions to show.
export const GROUP_MEAN_MIN = 3;

/** One counting answer as the objective page reads it. */
export interface ReviewAnswer {
	author: string;
	/// The counting submission's `publicId`.
	submission: string;
	payload: unknown;
	state: AnswerState;
	/// The current verdict in [-1, 1], or `null` unless graded.
	verdict: number | null;
	passes: GradingPass[];
	/// Set when the instructor created the submission.
	createdBy?: string;
	/// The student's mean on the other questions in [-1, 1], or `null` (see `restMeans`).
	restMean: number | null;
}

/** One student of a group. */
export interface GroupMember {
	author: string;
	submission: string;
	/// The score of the newest automatic pass (`autoScoreOf`).
	autoScore: number | null;
	/// The current verdict.
	score: number | null;
	/// Whether the verdict was changed by hand (`isManualChange`).
	changed: boolean;
	restMean: number | null;
	/// What this student answered, as `responseSummary` puts it, when it differs from the row text.
	detail?: string;
}

/// What a row shows as the response, by question type.
export type ResponseCell =
	| { kind: "choice"; marker: "radio" | "checkbox"; key: boolean; text: string }
	| {
			kind: "choices";
			boxes: { letter: string; on: boolean; key: boolean }[];
			text: string;
	  }
	| { kind: "text"; text: string }
	| { kind: "chips"; chips: { text: string; ok: boolean }[]; text: string }
	| {
			kind: "statement";
			text: string;
			truth: boolean;
			marked: { true: number; false: number };
	  };

/** One row of a grouped table. */
export interface AnswerGroup {
	/// Unique within its section.
	id: string;
	cell: ResponseCell;
	/// A second line under the response, e.g. "3 grafias".
	sub?: string;
	count: number;
	/// count / answers of the section, in [0, 1].
	share: number;
	/// The common verdict of the graded members; "varies" when they differ; `null` with none graded.
	score: number | "varies" | null;
	/// How many members are `changed`.
	changed: number;
	/// Mean of the members' `restMean`, `null` when fewer than GROUP_MEAN_MIN members have one.
	mean: number | null;
	/// Whether the row asks to check the key (see `needsReview`).
	review: boolean;
	members: GroupMember[];
}

/// One block of the page: a grouped table, a histogram, a matrix, or the list of who missed a blank.
export type ReviewSection =
	| {
			kind: "groups";
			block:
				| "choices"
				| "alternatives"
				| "combinations"
				| "statements"
				| "texts"
				| "blank"
				| "values"
				| "orders";
			/// The blank's label for `block: "blank"` ("Lacuna 1"), absent otherwise.
			label?: string;
			/// Which column the score shows: the score, accepted yes/no/partial, or none.
			column: "score" | "accepted" | "none";
			rows: AnswerGroup[];
	  }
	| { kind: "histogram"; histogram: NumericHistogram }
	| { kind: "matrix"; matrix: OrderingMatrix }
	/// Fill-in: who missed any blank, most misses first.
	| { kind: "missed"; members: GroupMember[] };

/** The distribution of numeric values around the key. */
export interface NumericHistogram {
	/// The accepted range of the key: answer ± max(absolute, |answer| × relative); [answer, answer] without tolerance.
	band: { low: number; high: number };
	/// The zoomed axis: the band widened by twice its width each side (by max(|answer| × 0.05, 1) when the band has width 0).
	window: { low: number; high: number };
	/// One bar per distinct value inside the window, ascending, with how many of them scored 1.
	bins: { value: number; count: number; correct: number }[];
	/// Values outside the window: the 4 largest groups by count, then one `value: null` bar with the rest.
	outside: { value: number | null; count: number }[];
}

/** Where each line of the key landed in the answers. */
export interface OrderingMatrix {
	/// The key's lines, in key order.
	steps: string[];
	/// cells[i][p]: how many answers placed step i at position p (line identity as `responseSummary` matches it).
	cells: number[][];
	/// The number of answers the matrix counts.
	answers: number;
}

/// An answer that needs the instructor before the page is done.
export type AttentionRow =
	| { kind: "pending"; author: string; submission: string }
	| { kind: "regrade"; author: string; submission: string; request: string };

/** A student whose result on the question the instructor changed. */
export interface OverrideRow {
	author: string;
	/// Absent when the student did not answer (a sanction on an empty attempt).
	submission?: string;
	kind: "grade" | "sanction";
	/// The automatic score (grade) or the score before the factor (sanction); `null` when the student did not answer.
	auto: number | null;
	final: number | null;
	comment: string | null;
	when: Date;
	/// The adjustment, for `kind: "sanction"`, so the row can revoke it.
	adjustment?: { publicId: string; updatedAt: Date };
}

/** The whole model of the page. */
export interface ObjectiveReview {
	summary: {
		/// Answers that statistics count (no instructor-created ones).
		answers: number;
		/// questionStats.correct for the question, in [0, 1], or `null`.
		correct: number | null;
		/// The discrimination value when `discriminationFlag` flags it, else `null`.
		lowDiscrimination: number | null;
		/// Answers in state `pending`.
		pending: number;
	};
	/// Pending answers first (submission order), then open regrade requests.
	attention: AttentionRow[];
	sections: ReviewSection[];
	/// Manual changes and question sanctions, newest `when` first.
	overrides: OverrideRow[];
}

/// The most combinations a multiple-selection page lists before lumping the rest into "others".
const MAX_COMBINATIONS = 5;

/// The most values outside the histogram window that get a bar of their own.
const MAX_OUTSIDE_BARS = 4;

/// How far a verdict may drift from another and still be the same score.
const SAME_SCORE = 1e-9;

/// An answer at full score.
const FULL = 1 - SAME_SCORE;

/// The mean of `values`, or `null` when there are none.
function average(values: readonly number[]): number | null {
	return values.length === 0
		? null
		: values.reduce((sum, value) => sum + value, 0) / values.length;
}

/// The mean of the numbers among `values`.
function averageOf(values: readonly (number | null)[]): number | null {
	return average(values.filter((value): value is number => value !== null));
}

/// The letter of the choice at `index`: A to Z, then AA, AB and so on.
function letter(index: number): string {
	const head = index >= 26 ? letter(Math.floor(index / 26) - 1) : "";
	return head + String.fromCharCode(65 + (index % 26));
}

/// The answer's passes oldest first, as `isManualChange` and `autoScoreOf` read them.
function oldestFirst(answer: ReviewAnswer): GradingPass[] {
	return [...answer.passes].reverse();
}

/// A review answer as a member of a group, with `detail` when given.
function memberOf(answer: ReviewAnswer, detail?: string): GroupMember {
	const passes = oldestFirst(answer);
	return {
		author: answer.author,
		submission: answer.submission,
		autoScore: autoScoreOf(passes),
		score: answer.verdict,
		changed: isManualChange(passes, answer.createdBy),
		restMean: answer.restMean,
		...(detail === undefined ? {} : { detail }),
	};
}

/// The common verdict of the graded members, `"varies"` when they differ, `null` with none graded.
function commonScore(
	members: readonly { answer: ReviewAnswer }[],
): number | "varies" | null {
	const verdicts = members.flatMap(({ answer }) =>
		answer.state === "graded" && answer.verdict !== null
			? [answer.verdict]
			: [],
	);
	const [first] = verdicts;
	if (first === undefined) return null;
	return verdicts.every((verdict) => Math.abs(verdict - first) < SAME_SCORE)
		? first
		: "varies";
}

/// One member of a row: the answer, with what to show under its name.
interface Member {
	answer: ReviewAnswer;
	detail?: string;
}

/// A grouped row from its `members`, out of `total` answers in the section.
function groupOf(
	id: string,
	cell: ResponseCell,
	members: readonly Member[],
	total: number,
	right: boolean | null,
	reference: number | null,
	extra: { sub?: string; score?: number | "varies" | null } = {},
): AnswerGroup {
	const rests = members
		.map(({ answer }) => answer.restMean)
		.filter((value): value is number => value !== null);
	const mean = rests.length >= GROUP_MEAN_MIN ? average(rests) : null;
	const cards = members.map(({ answer, detail }) => memberOf(answer, detail));
	return {
		id,
		cell,
		...(extra.sub === undefined ? {} : { sub: extra.sub }),
		count: members.length,
		share: total === 0 ? 0 : members.length / total,
		score: extra.score === undefined ? commonScore(members) : extra.score,
		changed: cards.filter((card) => card.changed).length,
		mean,
		review: right !== null && needsReview({ mean, right }, reference),
		members: cards,
	};
}

/// Whether the automatic score of `answer` is full, or `null` when it has none.
function autoFull(answer: ReviewAnswer): boolean | null {
	const score = autoScoreOf(oldestFirst(answer));
	return score === null ? null : score >= FULL;
}

/// Whether a row is right given whether each member is: any full member, `null` when none has a score to judge.
function rightOf(fulls: readonly (boolean | null)[]): boolean | null {
	if (fulls.some((full) => full === true)) return true;
	return fulls.every((full) => full === null) ? null : false;
}

/// The mean on the other questions of whoever got the answer fully right by the automatic score.
function referenceMean(answers: readonly ReviewAnswer[]): number | null {
	return averageOf(
		answers
			.filter((answer) => autoFull(answer) === true)
			.map((answer) => answer.restMean),
	);
}

/// The rows ordered by count, largest first; equal counts keep their order.
function byCount(rows: AnswerGroup[]): AnswerGroup[] {
	return rows.sort((a, b) => b.count - a.count);
}

/// The summary of `payload` as a group member's detail.
function summaryDetail(question: QuestionDocument, payload: unknown): string {
	return responseSummary(question, payload).text;
}

/// An id holding a single string, or `null` for a blank or malformed payload.
function chosenId(payload: unknown): string | null {
	return typeof payload === "string" && payload !== "" ? payload : null;
}

/// The payload as a record of verdicts or values; empty for anything else.
function recordOf(payload: unknown): Record<string, unknown> {
	return typeof payload === "object" &&
		payload !== null &&
		!Array.isArray(payload)
		? (payload as Record<string, unknown>)
		: {};
}

function choiceSections(
	question: Extract<QuestionDocument, { type: "multiple-choice" }>,
	answers: readonly ReviewAnswer[],
): ReviewSection[] {
	const reference = referenceMean(answers);
	const total = answers.length;
	const ids = question.choices.map((choice) => choice.id ?? "");
	const byId = new Map<string, ReviewAnswer[]>();
	const removed = new Map<string, ReviewAnswer[]>();
	const blank: ReviewAnswer[] = [];
	for (const answer of answers) {
		const id = chosenId(answer.payload);
		if (id === null) blank.push(answer);
		else if (ids.includes(id)) byId.set(id, [...(byId.get(id) ?? []), answer]);
		else removed.set(id, [...(removed.get(id) ?? []), answer]);
	}
	const asMembers = (list: readonly ReviewAnswer[] | undefined): Member[] =>
		(list ?? []).map((answer) => ({ answer }));
	const rows = question.choices.map((choice, index) => {
		const key = (choice.score ?? 0) >= FULL;
		return groupOf(
			ids[index] ?? "",
			{
				kind: "choice",
				marker: "radio",
				key,
				text: responseSummary(question, ids[index]).text,
			},
			asMembers(byId.get(ids[index] ?? "")),
			total,
			key,
			reference,
		);
	});
	for (const [id, list] of removed) {
		rows.push(
			groupOf(
				`removed:${id}`,
				{
					kind: "choice",
					marker: "radio",
					key: false,
					text: m.grades_summary_removed(),
				},
				asMembers(list),
				total,
				null,
				reference,
			),
		);
	}
	if (blank.length > 0) {
		rows.push(
			groupOf(
				"blank",
				{
					kind: "choice",
					marker: "radio",
					key: false,
					text: m.grades_summary_blank(),
				},
				asMembers(blank),
				total,
				null,
				reference,
			),
		);
	}
	return [{ kind: "groups", block: "choices", column: "score", rows }];
}

function selectionSections(
	question: Extract<QuestionDocument, { type: "multiple-selection" }>,
	answers: readonly ReviewAnswer[],
): ReviewSection[] {
	const reference = referenceMean(answers);
	const total = answers.length;
	const ids = question.choices.map((choice) => choice.id ?? "");
	const ticked = answers.map(
		(answer) =>
			new Set<unknown>(Array.isArray(answer.payload) ? answer.payload : []),
	);
	const alternatives = question.choices.map((choice, index) => {
		const members = answers.flatMap((answer, at) =>
			ticked[at]?.has(ids[index]) ? [{ answer }] : [],
		);
		return groupOf(
			ids[index] ?? "",
			{
				kind: "choice",
				marker: "checkbox",
				key: choice.correct === true,
				text: `${letter(index)}. ${plain(choice.text)}`,
			},
			members.map(({ answer }) => ({
				answer,
				detail: summaryDetail(question, answer.payload),
			})),
			total,
			choice.correct === true,
			reference,
		);
	});

	const combos = new Map<string, ReviewAnswer[]>();
	answers.forEach((answer, at) => {
		const picked = ticked[at] ?? new Set();
		const known = ids.filter((id) => picked.has(id));
		const unknown = [...picked]
			.filter((id): id is string => typeof id === "string" && !ids.includes(id))
			.sort();
		const key = JSON.stringify([...known, ...unknown]);
		combos.set(key, [...(combos.get(key) ?? []), answer]);
	});
	const ordered = [...combos.entries()].sort(
		([, a], [, b]) => b.length - a.length,
	);
	const rows = ordered.slice(0, MAX_COMBINATIONS).map(([key, list]) => {
		const picked = new Set<unknown>(JSON.parse(key) as string[]);
		const boxes = question.choices.map((choice, index) => ({
			letter: letter(index),
			on: picked.has(ids[index]),
			key: choice.correct === true,
		}));
		const right =
			boxes.every((box) => box.on === box.key) &&
			[...picked].every((id) => ids.includes(id as string));
		return groupOf(
			key,
			{
				kind: "choices",
				boxes,
				text: boxes
					.filter((box) => box.on)
					.map((box) => box.letter)
					.join(", "),
			},
			list.map((answer) => ({ answer })),
			total,
			right,
			reference,
		);
	});
	const rest = ordered.slice(MAX_COMBINATIONS).flatMap(([, list]) => list);
	if (rest.length > 0) {
		rows.push(
			groupOf(
				"others",
				{ kind: "text", text: m.grades_objective_others() },
				rest.map((answer) => ({ answer })),
				total,
				null,
				reference,
			),
		);
	}
	return [
		{
			kind: "groups",
			block: "alternatives",
			column: "none",
			rows: alternatives,
		},
		{ kind: "groups", block: "combinations", column: "none", rows },
	];
}

function statementSections(
	question: Extract<QuestionDocument, { type: "true-false" }>,
	answers: readonly ReviewAnswer[],
): ReviewSection[] {
	const total = answers.length;
	const verdicts = answers.map((answer) => recordOf(answer.payload));
	const rows = question.choices.map((choice) => {
		const id = choice.id ?? "";
		const truth = choice.correct === true;
		const right: ReviewAnswer[] = [];
		const wrong: ReviewAnswer[] = [];
		let markedTrue = 0;
		let markedFalse = 0;
		answers.forEach((answer, at) => {
			const mark = verdicts[at]?.[id];
			if (mark === true) markedTrue += 1;
			if (mark === false) markedFalse += 1;
			(mark === truth ? right : wrong).push(answer);
		});
		return groupOf(
			id,
			{
				kind: "statement",
				text: plain(choice.text),
				truth,
				marked: { true: markedTrue, false: markedFalse },
			},
			wrong.map((answer) => ({
				answer,
				detail: summaryDetail(question, answer.payload),
			})),
			total,
			false,
			averageOf(right.map((answer) => answer.restMean)),
		);
	});
	return [{ kind: "groups", block: "statements", column: "none", rows }];
}

/// A text as its comparison key: no accents, case or extra spaces.
function textKey(text: string): string {
	return text
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/// A text with its whitespace collapsed, as a spelling.
function spelling(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

/// One answer's text for `textRows`, with whether it is fully right (`null`: nothing to judge by) and its own score.
interface TextEntry {
	answer: ReviewAnswer;
	text: string;
	full: boolean | null;
	mark?: number | null;
}

/// The common score of `marks`, `"varies"` when they differ, `null` with none.
function commonMark(
	marks: readonly (number | null)[],
): number | "varies" | null {
	const known = marks.filter((mark): mark is number => mark !== null);
	const [first] = known;
	if (first === undefined) return null;
	return known.every((mark) => Math.abs(mark - first) < SAME_SCORE)
		? first
		: "varies";
}

/// The rows of free texts, where texts that match once case, accents and spacing are ignored form one row.
///
/// A blank text gets its own row, and no review. A row's score is the entries' `mark` when they have one.
function textRows(entries: readonly TextEntry[], total: number): AnswerGroup[] {
	const reference = averageOf(
		entries
			.filter((entry) => entry.full === true)
			.map((entry) => entry.answer.restMean),
	);
	const groups = new Map<string, TextEntry[]>();
	for (const entry of entries) {
		const key = textKey(entry.text);
		groups.set(key, [...(groups.get(key) ?? []), entry]);
	}
	const rows = [...groups.entries()].map(([key, list]) => {
		const tally = new Map<string, number>();
		for (const { text } of list) {
			const own = spelling(text);
			tally.set(own, (tally.get(own) ?? 0) + 1);
		}
		const common = [...tally.entries()].reduce((best, entry) =>
			entry[1] > best[1] ? entry : best,
		)[0];
		const text = key === "" ? m.grades_summary_blank() : common;
		const spellings = key === "" ? 1 : tally.size;
		const members = list.map(({ answer, text: own }) => ({
			answer,
			...(key === "" || spelling(own) === common
				? {}
				: { detail: spelling(own) }),
		}));
		return groupOf(
			key,
			{ kind: "text", text },
			members,
			total,
			key === "" ? null : rightOf(list.map((entry) => entry.full)),
			reference,
			{
				...(spellings > 1
					? { sub: m.grades_objective_spellings({ count: spellings }) }
					: {}),
				...(list.some((entry) => entry.mark !== undefined)
					? { score: commonMark(list.map((entry) => entry.mark ?? null)) }
					: {}),
			},
		);
	});
	return byCount(rows);
}

function shortAnswerSections(
	answers: readonly ReviewAnswer[],
): ReviewSection[] {
	const entries = answers.map((answer) => ({
		answer,
		text: typeof answer.payload === "string" ? answer.payload : "",
		full: autoFull(answer),
	}));
	return [
		{
			kind: "groups",
			block: "texts",
			column: "accepted",
			rows: textRows(entries, answers.length),
		},
	];
}

/// A blank's value in the response as text; empty when the response left it blank.
function blankValue(
	blank: Extract<QuestionDocument, { type: "fill-in" }>["blanks"][number],
	value: unknown,
): string {
	if (value === null || value === undefined) return "";
	if (blank.type === "multiple-choice") {
		if (typeof value !== "string" || value === "") return "";
		const choice = blank.choices.find((entry) => entry.id === value);
		return choice ? plain(choice.text) : m.grades_summary_removed();
	}
	if (typeof value === "object") {
		const { value: amount, unit } = value as { value?: unknown; unit?: string };
		return amount === undefined
			? ""
			: unit
				? `${amount} ${unit}`
				: String(amount);
	}
	return String(value).trim();
}

/// The score of each blank of the answer, `null` for one still pending or when the response is not valid.
function blankMarks(
	question: Extract<QuestionDocument, { type: "fill-in" }>,
	answer: ReviewAnswer,
): Record<string, number | null> {
	const { blanks } = reviewResult(question, answer.payload, {
		score: answer.verdict,
	});
	return Object.fromEntries(
		question.blanks.map((blank) => [
			blank.id,
			blanks?.[blank.id]?.score ?? null,
		]),
	);
}

function fillInSections(
	question: Extract<QuestionDocument, { type: "fill-in" }>,
	answers: readonly ReviewAnswer[],
): ReviewSection[] {
	const values = answers.map((answer) => recordOf(answer.payload));
	const marks = answers.map((answer) => blankMarks(question, answer));
	const blanks: ReviewSection[] = question.blanks.map((blank, index) => {
		const entries = answers.map((answer, at) => {
			const mark = marks[at]?.[blank.id] ?? null;
			return {
				answer,
				text: blankValue(blank, values[at]?.[blank.id]),
				full: mark === null ? null : mark >= FULL,
				mark,
			};
		});
		return {
			kind: "groups",
			block: "blank",
			label: m.grades_objective_blank({ number: index + 1 }),
			column: "accepted",
			rows: textRows(entries, answers.length),
		};
	});
	const missed = answers
		.map((answer, at) => ({
			answer,
			misses: Object.values(marks[at] ?? {}).filter(
				(mark) => mark !== null && mark < FULL,
			).length,
		}))
		.filter(({ misses }) => misses > 0)
		.sort((a, b) => b.misses - a.misses)
		.map(({ answer }) =>
			memberOf(answer, summaryDetail(question, answer.payload)),
		);
	return [...blanks, { kind: "missed", members: missed }];
}

/// A numeric payload as a number, `null` when it is not one.
function numberOf(payload: unknown): number | null {
	const raw =
		typeof payload === "object" && payload !== null && "value" in payload
			? (payload as { value: unknown }).value
			: payload;
	if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
	if (typeof raw !== "string" || raw.trim() === "") return null;
	const [top, bottom, ...extra] = raw.trim().split("/");
	const value =
		bottom === undefined ? Number(top) : Number(top) / Number(bottom);
	return extra.length === 0 && Number.isFinite(value) ? value : null;
}

/// The band the key accepts and the window around it, or `null` when the key is not a number.
function histogramFrame(
	question: Extract<QuestionDocument, { type: "numeric" }>,
): Pick<NumericHistogram, "band" | "window"> | null {
	const answer = numberOf(question.answer);
	if (answer === null) return null;
	const { absolute = 0, relative = 0 } = question.tolerance ?? {};
	const half = Math.max(absolute, Math.abs(answer) * relative);
	const band = { low: answer - half, high: answer + half };
	const width = band.high - band.low;
	const pad = width > 0 ? 2 * width : Math.max(Math.abs(answer) * 0.05, 1);
	return {
		band,
		window: { low: band.low - pad, high: band.high + pad },
	};
}

/// Whether a payload is no answer at all.
function isBlank(payload: unknown): boolean {
	return payload === null || payload === undefined || payload === "";
}

function numericSections(
	question: Extract<QuestionDocument, { type: "numeric" }>,
	answers: readonly ReviewAnswer[],
): ReviewSection[] {
	const reference = referenceMean(answers);
	const total = answers.length;
	const texts = new Map<string, ReviewAnswer[]>();
	for (const answer of answers) {
		const text = responseSummary(question, answer.payload).text;
		texts.set(text, [...(texts.get(text) ?? []), answer]);
	}
	const rows = byCount(
		[...texts.entries()].map(([text, list]) =>
			groupOf(
				text,
				{ kind: "text", text },
				list.map((answer) => ({ answer })),
				total,
				list.every((answer) => isBlank(answer.payload))
					? null
					: rightOf(list.map(autoFull)),
				reference,
			),
		),
	);
	const sections: ReviewSection[] = [];
	const frame = histogramFrame(question);
	if (frame) {
		const bins = new Map<number, { count: number; correct: number }>();
		const outside = new Map<number, number>();
		for (const answer of answers) {
			const value = numberOf(answer.payload);
			if (value === null) continue;
			if (value >= frame.window.low && value <= frame.window.high) {
				const bin = bins.get(value) ?? { count: 0, correct: 0 };
				bin.count += 1;
				if ((answer.verdict ?? 0) >= FULL) bin.correct += 1;
				bins.set(value, bin);
			} else {
				outside.set(value, (outside.get(value) ?? 0) + 1);
			}
		}
		const far = [...outside.entries()].sort(([, a], [, b]) => b - a);
		const rest = far
			.slice(MAX_OUTSIDE_BARS)
			.reduce((sum, [, count]) => sum + count, 0);
		sections.push({
			kind: "histogram",
			histogram: {
				...frame,
				bins: [...bins.entries()]
					.sort(([a], [b]) => a - b)
					.map(([value, bin]) => ({ value, ...bin })),
				outside: [
					...far
						.slice(0, MAX_OUTSIDE_BARS)
						.map(([value, count]) => ({ value, count })),
					...(rest > 0 ? [{ value: null, count: rest }] : []),
				],
			},
		});
	}
	sections.push({ kind: "groups", block: "values", column: "score", rows });
	return sections;
}

/// Whether two ordering lines are the same line.
function sameLine(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/// The text of a line, without its indentation.
function lineText(line: unknown): string {
	return Array.isArray(line) ? String(line[1] ?? "") : String(line);
}

/// For each response line, the index of the key line it is, or -1; a key line is taken once.
function placements(
	lines: readonly unknown[],
	response: readonly unknown[],
): number[] {
	const taken = new Set<number>();
	return response.map((line) => {
		const at = lines.findIndex(
			(entry, index) => !taken.has(index) && sameLine(entry, line),
		);
		if (at >= 0) taken.add(at);
		return at;
	});
}

function orderingSections(
	question: Extract<QuestionDocument, { type: "ordering" }>,
	answers: readonly ReviewAnswer[],
): ReviewSection[] {
	const lines = question.lines as readonly unknown[];
	const cells = lines.map(() => lines.map(() => 0));
	let counted = 0;
	const orders = new Map<string, ReviewAnswer[]>();
	for (const answer of answers) {
		const key = Array.isArray(answer.payload)
			? JSON.stringify(answer.payload)
			: "";
		orders.set(key, [...(orders.get(key) ?? []), answer]);
		if (!Array.isArray(answer.payload)) continue;
		counted += 1;
		placements(lines, answer.payload).forEach((at, position) => {
			const row = cells[at];
			if (row && position < lines.length)
				row[position] = (row[position] ?? 0) + 1;
		});
	}
	const reference = referenceMean(answers);
	const rows = byCount(
		[...orders.entries()].map(([key, list]) => {
			const members = list.map((answer) => ({ answer }));
			if (key === "") {
				return groupOf(
					"blank",
					{ kind: "text", text: m.grades_summary_blank() },
					members,
					answers.length,
					null,
					reference,
				);
			}
			const response = JSON.parse(key) as unknown[];
			const chips = response.map((line, position) => ({
				text: lineText(line),
				ok: sameLine(lines[position], line),
			}));
			return groupOf(
				key,
				{
					kind: "chips",
					chips,
					text: summaryDetail(question, response),
				},
				members,
				answers.length,
				chips.length === lines.length && chips.every((chip) => chip.ok),
				reference,
			);
		}),
	);
	return [
		{
			kind: "matrix",
			matrix: { steps: lines.map(lineText), cells, answers: counted },
		},
		{ kind: "groups", block: "orders", column: "score", rows },
	];
}

/**
 * Each author's mean score on the exam's other questions, from `examResult` without adjustments.
 *
 * Weighted by the question weights, with `pending` questions left out and unanswered and not-graded counting 0;
 * `null` when no other question has a score.
 */
export function restMeans(
	questions: readonly WeightedQuestion[],
	question: string,
	attempts: readonly GradingAttempt[],
	feedback: readonly GradingFeedback[],
	policy?: ResultPolicy,
): Map<string, number | null> {
	const others = questions.filter((entry) => entry.slug !== question);
	const means = new Map<string, number | null>();
	for (const attempt of attempts) {
		const result = examResult(
			others,
			attempt.submissions,
			[...feedback],
			[],
			policy,
		);
		let sum = 0;
		let weights = 0;
		result.questions.forEach((outcome, index) => {
			if (outcome.status === "pending") return;
			const weight = others[index]?.weight ?? 0;
			sum += (outcome.score ?? 0) * weight;
			weights += weight;
		});
		means.set(attempt.author, weights > 0 ? sum / weights : null);
	}
	return means;
}

/**
 * Whether a wrong row asks to check the key: its mean is at least `reference`.
 *
 * `false` when either is `null` or the row is right.
 */
export function needsReview(
	row: { mean: number | null; right: boolean },
	reference: number | null,
): boolean {
	if (row.right || row.mean === null || reference === null) return false;
	return row.mean >= reference;
}

/**
 * The sections of the page for the question's type, leaving out instructor-created answers.
 *
 * Any type the page does not review gives no section.
 */
export function answerSections(
	question: QuestionDocument,
	answers: readonly ReviewAnswer[],
): ReviewSection[] {
	const counted = answers.filter((answer) => !answer.createdBy);
	switch (question.type) {
		case "multiple-choice":
			return choiceSections(question, counted);
		case "multiple-selection":
			return selectionSections(question, counted);
		case "true-false":
			return statementSections(question, counted);
		case "short-answer":
			return shortAnswerSections(counted);
		case "fill-in":
			return fillInSections(question, counted);
		case "numeric":
			return numericSections(question, counted);
		case "ordering":
			return orderingSections(question, counted);
		default:
			return [];
	}
}

/// The score of a sanctioned answer: the factor applies to a positive score only, and an unscored one is 0 under a factor of 0.
function sanctioned(score: number | null, value: number): number | null {
	if (score === null) return value === 0 ? 0 : null;
	return score > 0 ? score * value : score;
}

/// The answers the instructor changed by hand or created, and the question's sanctions, newest first.
function overrideRows(
	answers: readonly ReviewAnswer[],
	sanctions: ObjectiveInput["sanctions"],
): OverrideRow[] {
	const rows: OverrideRow[] = [];
	for (const answer of answers) {
		const passes = oldestFirst(answer);
		const [newest] = answer.passes;
		if (!newest || !isManualChange(passes, answer.createdBy)) continue;
		rows.push({
			author: answer.author,
			submission: answer.submission,
			kind: "grade",
			auto: autoScoreOf(passes),
			final: answer.verdict,
			comment: newest.comment,
			when: newest.updatedAt,
		});
	}
	const byAuthor = new Map(answers.map((answer) => [answer.author, answer]));
	for (const [author, adjustment] of sanctions) {
		const answer = byAuthor.get(author);
		const auto = answer?.verdict ?? null;
		rows.push({
			author,
			...(answer ? { submission: answer.submission } : {}),
			kind: "sanction",
			auto,
			final: sanctioned(auto, adjustment.value),
			comment: adjustment.reason,
			when: adjustment.updatedAt,
			adjustment: {
				publicId: adjustment.publicId,
				updatedAt: adjustment.updatedAt,
			},
		});
	}
	return rows.sort((a, b) => b.when.getTime() - a.when.getTime());
}

/// The input of `objectiveReview`.
interface ObjectiveInput {
	question: QuestionDocument;
	/// The question's slug; the model does not read it.
	slug: string;
	answers: readonly ReviewAnswer[];
	stats: Pick<QuestionStats, "correct" | "discrimination">;
	/// Open regrade requests on this question: submission publicId to request publicId.
	regrades: ReadonlyMap<string, string>;
	/// Active adjustments on this question, by author.
	sanctions: ReadonlyMap<
		string,
		{ publicId: string; value: number; reason: string | null; updatedAt: Date }
	>;
}

/** The whole page model: `answerSections` plus summary, attention and overrides. */
export function objectiveReview(input: ObjectiveInput): ObjectiveReview {
	const counted = input.answers.filter((answer) => !answer.createdBy);
	const pending = counted.filter((answer) => answer.state === "pending");
	const bySubmission = new Map(
		counted.map((answer) => [answer.submission, answer]),
	);
	const regrades = [...input.regrades].flatMap(([submission, request]) => {
		const answer = bySubmission.get(submission);
		return answer
			? [
					{
						kind: "regrade" as const,
						author: answer.author,
						submission,
						request,
					},
				]
			: [];
	});
	return {
		summary: {
			answers: counted.length,
			correct: input.stats.correct,
			lowDiscrimination:
				discriminationFlag(input.stats.discrimination) === null
					? null
					: input.stats.discrimination,
			pending: pending.length,
		},
		attention: [
			...pending.map((answer) => ({
				kind: "pending" as const,
				author: answer.author,
				submission: answer.submission,
			})),
			...regrades,
		],
		sections: answerSections(input.question, input.answers),
		overrides: overrideRows(input.answers, input.sanctions),
	};
}
