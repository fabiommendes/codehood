/**
 * Grading of `code` questions from a runner report.
 *
 * Pure: it never reads the database. The caller loads the private question
 * document (with its test sources resolved) and the report a worker sent, and
 * this decides what the report means, what the question scores over several
 * submissions, and what a student may see of it.
 */

import {
	type CodeQuestion,
	checkReport,
	type FullRubricItem,
	fullRubric,
	ReportError,
	type RunnerReport,
	scoreCode,
} from "mdq";
import { InvalidData } from "@/core/error";

/// Graded submissions a student may send per attempt when the question does not say.
export const DEFAULT_CODE_ATTEMPTS = 4;

/// Discount per earlier wrong submission when the question does not say.
export const DEFAULT_CODE_PENALTY = 0.2;

/** What a report means for a submission. */
export type ReportDecision =
	/** Infrastructure failure: the report says nothing about the submission. */
	| { outcome: "retry"; error: string }
	/** A build error or a failing pretest: the student may send again at no cost. */
	| { outcome: "pretest-failed" }
	/** The score in `[-1, 1]` and the feedback text, one line per rubric item. */
	| { outcome: "graded"; score: number; feedback: string };

/// A rubric item that tests own, with the region of lines it covers.
interface Region {
	item: FullRubricItem;
	/// Display text of the item, never empty.
	text: string;
	first: number;
	last: number;
}

/// A region together with the report cases that fall in it.
interface OwnedRegion extends Region {
	cases: RunnerReport["cases"];
	/// Whether every case passed. An item with no case passes when it is a discount.
	passed: boolean;
}

/**
 * Validates `report` against `question`, as mdq does.
 *
 * @throws {InvalidData} The report is invalid, does not fit the question or is missing.
 */
function checked(question: CodeQuestion, report: unknown): RunnerReport {
	let parsed: RunnerReport | null;
	try {
		parsed = checkReport(question, report);
	} catch (error) {
		if (error instanceof ReportError) throw invalidReport(error.message);
		throw error;
	}
	if (parsed === null) {
		throw invalidReport("the question has no test source to report on");
	}
	return parsed;
}

function invalidReport(message: string): InvalidData {
	return new InvalidData(
		{ report: [{ code: "invalid", message }] },
		{ message },
	);
}

/// The regions of the test items, sorted by source and line.
function regionsOf(question: CodeQuestion): Region[] {
	const items = fullRubric(question).filter((item) => item.binding === "tests");
	return items.map((item) => {
		const source = item.source as number;
		const line = item.line ?? 1;
		const next = items
			.filter(
				(other) =>
					other.source === source &&
					other.line !== undefined &&
					other.line > line,
			)
			.map((other) => other.line as number);
		const origin = question.tests?.[source]?.origin;
		return {
			item,
			text: item.text ?? origin ?? `tests[${source}]`,
			first: line,
			last: next.length > 0 ? Math.min(...next) - 1 : Number.POSITIVE_INFINITY,
		};
	});
}

/// Each region with its cases and whether it passed, for a report with status `completed`.
function ownedRegions(
	question: CodeQuestion,
	report: RunnerReport,
): OwnedRegion[] {
	return regionsOf(question).map((region) => {
		const cases = report.cases.filter(
			(c) =>
				c.source === region.item.source &&
				region.first <= c.line &&
				c.line <= region.last,
		);
		const allPass = cases.every((c) => c.verdict === "pass");
		const passed = cases.length > 0 ? allPass : region.item.value <= 0;
		return { ...region, cases, passed };
	});
}

/// Whether a public region of value 0 has a case that did not pass.
function failsPretest(regions: OwnedRegion[]): boolean {
	return regions.some(
		(region) =>
			region.item.public &&
			region.item.value === 0 &&
			region.cases.some((c) => c.verdict !== "pass"),
	);
}

/**
 * What `report` means for `question`: retry, pretest failure, or a graded
 * submission with its score and feedback.
 *
 * @throws {InvalidData} The report is invalid or does not serve the question; the message is mdq's.
 */
export function decideReport(
	question: CodeQuestion,
	report: unknown,
): ReportDecision {
	const parsed = checked(question, report);
	if (parsed.status === "runner-error") {
		return { outcome: "retry", error: parsed.message ?? "runner-error" };
	}
	if (parsed.status === "build-error") return { outcome: "pretest-failed" };
	const regions = ownedRegions(question, parsed);
	if (failsPretest(regions)) return { outcome: "pretest-failed" };
	const { score } = scoreCode(question, { report: parsed });
	return { outcome: "graded", score, feedback: feedbackText(regions) };
}

/// One line per item, `✓` or `✗` and its text, plus the hint of a failed item.
function feedbackText(regions: OwnedRegion[]): string {
	return regions
		.flatMap((region) => {
			const mark = `${region.passed ? "✓" : "✗"} ${region.text}`;
			return region.passed || region.item.feedback === undefined
				? [mark]
				: [mark, region.item.feedback];
		})
		.join("\n");
}

/** How one graded submission weighs in the question's score. */
export interface CodeQuestionScore {
	/// The question's score in `[0, 1]`, or `null` with no graded submission.
	score: number | null;
	/// Index in the input of the submission that counts, or `null` with none.
	counting: number | null;
	/// Each submission's score after its discount, floored at 0.
	discounted: number[];
}

/**
 * The score of a code question from the scores of its graded submissions, oldest first.
 *
 * Each submission loses `penalty` for every earlier one that scored below 1;
 * the best discounted score counts, the earliest breaking a tie, floored at 0.
 *
 * @example
 * codeQuestionScore([0.6, 1.0], 0.2); // { score: 0.8, counting: 1, discounted: [0.6, 0.8] }
 */
export function codeQuestionScore(
	scores: readonly number[],
	penalty: number,
): CodeQuestionScore {
	let wrong = 0;
	const raw = scores.map((score) => {
		const value = round(score - penalty * wrong);
		if (score < 1) wrong += 1;
		return value;
	});
	if (raw.length === 0) return { score: null, counting: null, discounted: [] };
	const counting = raw.indexOf(Math.max(...raw));
	const discounted = raw.map((value) => Math.max(0, value));
	return {
		score: discounted[counting] as number,
		counting,
		discounted,
	};
}

/// Trims the float noise of a discount (`1 - 0.2 * 3` is not `0.4`).
function round(value: number): number {
	return Number(value.toPrecision(12));
}

/** What decides how much of a graded submission a student sees. */
export interface GradeVisibility {
	mode: "PRACTICE" | "QUIZ" | "EXAM";
	/// The question's graded submissions per attempt.
	attempts: number;
	/// Whether the exam's release rule already lets the student see grades.
	released: boolean;
}

/** A case of a public region, as the student sees it. */
export interface PublicCaseView {
	source: number;
	line: number;
	verdict: RunnerReport["cases"][number]["verdict"];
	id?: string;
	message?: string;
}

/** A rubric item and whether it passed. Hidden test cases appear only here. */
export interface ItemView {
	text: string;
	passed: boolean;
	/// The author's hint, only on a failed item.
	feedback?: string;
}

/** What a student may receive of a runner report. */
export interface StudentReportView {
	outcome: ReportDecision["outcome"];
	/// Public cases with their verdicts, always shown.
	publicCases: PublicCaseView[];
	/// The compiler message, with a build error.
	build?: string;
	/// Present only when the grade is visible.
	items?: ItemView[];
	/// Present only when the grade is visible.
	score?: number;
}

/// Whether a student sees the score and the items of a graded submission now.
function gradeVisible({ mode, attempts, released }: GradeVisibility): boolean {
	return mode === "PRACTICE" || attempts > 1 || released;
}

/**
 * The part of a runner report a student may see, with nothing of a hidden case.
 *
 * Public cases always show. The score and the rubric items show when the
 * visibility allows it, and a hidden case reaches the student only as its item.
 *
 * @throws {InvalidData} The report is invalid or does not serve the question.
 */
export function studentReportView(
	question: CodeQuestion,
	report: unknown,
	visibility: GradeVisibility,
): StudentReportView {
	const decision = decideReport(question, report);
	const parsed = checked(question, report);
	if (decision.outcome === "retry")
		return { outcome: "retry", publicCases: [] };
	if (parsed.status === "build-error") {
		return {
			outcome: "pretest-failed",
			publicCases: [],
			...(parsed.build === undefined ? {} : { build: parsed.build }),
		};
	}
	const regions = ownedRegions(question, parsed);
	const publicCases = regions
		.filter((region) => region.item.public)
		.flatMap((region) => region.cases)
		.map(
			(c): PublicCaseView => ({
				source: c.source,
				line: c.line,
				verdict: c.verdict,
				...(c.id === undefined ? {} : { id: c.id }),
				...(c.message === undefined ? {} : { message: c.message }),
			}),
		);
	if (decision.outcome !== "graded" || !gradeVisible(visibility)) {
		return { outcome: decision.outcome, publicCases };
	}
	return {
		outcome: "graded",
		publicCases,
		score: decision.score,
		items: regions.map(
			(region): ItemView => ({
				text: region.text,
				passed: region.passed,
				...(region.passed || region.item.feedback === undefined
					? {}
					: { feedback: region.item.feedback }),
			}),
		),
	};
}
