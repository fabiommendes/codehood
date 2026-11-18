import { actions } from "astro:actions";
import { errorMessage } from "@/forms/field-errors";
import type { GradingTarget } from "./grading-target";

/// Where the objective page sends its grades: the course's URL segments, the exam and the question.
export type GradeTarget = GradingTarget;

/** A score in [-1, 1] as a whole percentage. */
export function percentOf(score: number): number {
	return Math.round(score * 100);
}

/** A date as the objective page lists it, the same on the server and in the browser. */
export function formatWhen(iso: string, locale: string): string {
	return new Date(iso).toLocaleDateString(locale, {
		year: "numeric",
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	});
}

/**
 * Records a manual grade on an answer, or on the question of a student who left it blank when `submission` is `null`.
 *
 * Resolves to the error message, or `undefined` when the grade was saved.
 */
export async function recordGrade(
	target: GradeTarget,
	answer: { submission: string | null; author: string },
	grade: { score: string; comment?: string },
): Promise<string | undefined> {
	const { discipline, course, exam, question } = target;
	const { error } = answer.submission
		? await actions.grading.grade({
				discipline,
				course,
				exam,
				submission: answer.submission,
				...grade,
			})
		: await actions.grading.gradeUnanswered({
				discipline,
				course,
				exam,
				author: answer.author,
				question,
				...grade,
			});
	return error ? errorMessage(error) : undefined;
}

/**
 * Undoes the change by hand of one answer (`kind: "grade"`) or revokes the sanction on it (`kind: "sanction"`).
 *
 * Resolves to the error message, or `undefined` when it worked.
 */
export async function undoOverride(
	target: GradeTarget,
	row:
		| { kind: "grade"; submission: string }
		| { kind: "sanction"; adjustment: { publicId: string; updatedAt: string } },
): Promise<string | undefined> {
	const { discipline, course, exam } = target;
	const { error } =
		row.kind === "grade"
			? await actions.grading.revert({
					discipline,
					course,
					exam,
					submission: row.submission,
				})
			: await actions.examAdjustment.revoke({
					discipline,
					course,
					exam,
					adjustment: row.adjustment.publicId,
					updatedAt: row.adjustment.updatedAt,
				});
	return error ? errorMessage(error) : undefined;
}
