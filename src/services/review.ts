/**
 * What a review screen shows for one answer: the marks and feedback the mdq
 * library gives it, and the grade stored for it.
 *
 * Pure: the caller hands in the question document, the student's response
 * and the current grade.
 */

import type { BlankGrade } from "@/core/schemas";
import {
	type BlankScore,
	combineBlanks,
	NotAutoGradable,
	type QuestionDocument,
	ResponseError,
	scoreBlanks,
	scoreResponse,
} from "@/mdq";

/// The score of each blank of a fill-in response, `null` for one still pending.
export type BlankScores = Record<string, BlankScore | null>;

/**
 * The `result` a question view takes in `review` mode: a score with its
 * feedback, or pending while an instructor has yet to grade the answer.
 */
export type ReviewResult =
	| { score: number; feedback: readonly string[]; blanks?: BlankScores }
	| { pending: true; blanks?: BlankScores };

/** The current grade of an answer, as the grading passes store it. */
export interface StoredGrade {
	/// The question score in `[-1, 1]`, or `null` while the answer waits for one.
	score: number | null;
	/// The instructor's grade of each pending blank, when they graded them one by one.
	blanks?: Record<string, BlankGrade> | null;
}

/**
 * The review result of `response` to `question`: the library's marks and
 * feedback, with the stored grade as the score.
 *
 * A blank the instructor graded by hand gets their score, and their comment as
 * its feedback. The stored score wins over the library's; without one, the
 * answer has the library's score, or is pending when only an instructor can
 * settle it. A response the library refuses shows no marks.
 */
export function reviewResult(
	question: QuestionDocument,
	response: unknown,
	grade: StoredGrade,
): ReviewResult {
	const marks = libraryMarks(question, response, grade.blanks ?? {});
	if (grade.score !== null) {
		return {
			score: grade.score,
			feedback: marks.feedback,
			blanks: marks.blanks,
		};
	}
	if (marks.score === undefined) return { pending: true, blanks: marks.blanks };
	return { score: marks.score, feedback: marks.feedback, blanks: marks.blanks };
}

/**
 * The ids of the blanks of a fill-in response that only an instructor can
 * grade, in definition order; empty for any other question or a malformed
 * response.
 */
export function pendingBlanks(
	question: QuestionDocument,
	response: unknown,
): string[] {
	if (question.type !== "fill-in") return [];
	try {
		return Object.entries(scoreBlanks(question, response))
			.filter(([, score]) => score === null)
			.map(([id]) => id);
	} catch (error) {
		if (error instanceof ResponseError) return [];
		throw error;
	}
}

/**
 * The question score of a fill-in response once the instructor graded each of
 * its pending blanks.
 *
 * @throws {RangeError} A grade names a blank that is not pending.
 * @throws {NotAutoGradable} A pending blank has no grade.
 * @throws {ResponseError} The response is not valid for the question.
 */
export function blanksScore(
	question: QuestionDocument,
	response: unknown,
	grades: Record<string, BlankGrade>,
): number {
	if (question.type !== "fill-in") {
		throw new RangeError(`a ${question.type} question has no blanks`);
	}
	const manual = Object.fromEntries(
		Object.entries(grades).map(([id, grade]) => [id, grade.score]),
	);
	return combineBlanks(question, response, manual).score;
}

/// The score, feedback and blank marks the library gives, with the hand-graded blanks filled in; no score while pending.
function libraryMarks(
	question: QuestionDocument,
	response: unknown,
	grades: Record<string, BlankGrade>,
): { score?: number; feedback: readonly string[]; blanks?: BlankScores } {
	try {
		const scored = scoreResponse(question, response);
		return {
			score: scored.score,
			feedback: scored.feedback,
			blanks: scored.blanks,
		};
	} catch (error) {
		if (error instanceof ResponseError) return { score: 0, feedback: [] };
		if (!(error instanceof NotAutoGradable)) throw error;
	}
	if (question.type !== "fill-in") return { feedback: [] };

	const blanks = withGrades(scoreBlanks(question, response), grades);
	const settled = Object.values(blanks).every((blank) => blank !== null);
	// Once every blank has a grade the response is settled, and the library
	// gives the feedback of the blanks it scored itself.
	const feedback = settled
		? combineBlanks(
				question,
				response,
				Object.fromEntries(
					Object.entries(grades).map(([id, grade]) => [id, grade.score]),
				),
			).feedback
		: [];
	return { feedback, blanks };
}

/// The blank scores with each pending blank the instructor graded replaced by their grade.
function withGrades(
	blanks: BlankScores,
	grades: Record<string, BlankGrade>,
): BlankScores {
	return Object.fromEntries(
		Object.entries(blanks).map(([id, score]) => {
			const grade = grades[id];
			if (score !== null || !grade) return [id, score];
			const comment = grade.comment?.trim();
			return [id, { score: grade.score, feedback: comment ? [comment] : [] }];
		}),
	);
}
