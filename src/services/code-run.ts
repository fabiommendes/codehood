/**
 * Whether students may run code while answering an exam.
 */

import type { Exam } from "@/db/services/exam.service";

/// What the rule needs from an exam. `allowCodeRun` is null when the course
/// repository does not set it.
export interface CodeRunSetting {
	type: Exam["type"];
	allowCodeRun: boolean | null;
}

/**
 * The effective setting and where it comes from, for the exam page to show
 * ("on (PRACTICE default)", "off (set by the instructor)").
 *
 * `default`: `allowCodeRun` is null and the exam type decides. `exam`: the
 * course repository set it.
 */
export interface EffectiveCodeRun {
	allowed: boolean;
	source: "default" | "exam";
}

/**
 * The effective code-run setting of `exam`.
 *
 * An explicit `allowCodeRun` wins; null follows the exam type: on for
 * `PRACTICE`, off for `QUIZ` and `EXAM`.
 *
 * @example
 * effectiveCodeRun({ type: "PRACTICE", allowCodeRun: null }); // { allowed: true, source: "default" }
 * effectiveCodeRun({ type: "EXAM", allowCodeRun: true }); // { allowed: true, source: "exam" }
 */
export function effectiveCodeRun(_exam: CodeRunSetting): EffectiveCodeRun {
	throw new Error("not implemented");
}

/**
 * Whether a student may run code while answering `exam`.
 *
 * Only answer mode asks: an instructor reviewing submissions can always run
 * them. Same as `effectiveCodeRun(exam).allowed`.
 */
export function canRunCode(_exam: CodeRunSetting): boolean {
	throw new Error("not implemented");
}
