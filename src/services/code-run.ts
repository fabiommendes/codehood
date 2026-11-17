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
 * The effective setting and where it comes from.
 *
 * `default`: `allowCodeRun` is null, which means on. `exam`: the course
 * repository set it.
 */
export interface EffectiveCodeRun {
	allowed: boolean;
	source: "default" | "exam";
}

/**
 * The effective code-run setting of `exam`.
 *
 * An explicit `allowCodeRun` wins; null means on, for every exam type.
 *
 * @example
 * effectiveCodeRun({ type: "EXAM", allowCodeRun: null }); // { allowed: true, source: "default" }
 * effectiveCodeRun({ type: "EXAM", allowCodeRun: false }); // { allowed: false, source: "exam" }
 */
export function effectiveCodeRun(exam: CodeRunSetting): EffectiveCodeRun {
	if (exam.allowCodeRun !== null) {
		return { allowed: exam.allowCodeRun, source: "exam" };
	}
	return { allowed: true, source: "default" };
}

/**
 * Whether a student may run code while answering `exam`.
 *
 * Only answer mode asks: an instructor reviewing submissions can always run
 * them. Same as `effectiveCodeRun(exam).allowed`.
 */
export function canRunCode(exam: CodeRunSetting): boolean {
	return effectiveCodeRun(exam).allowed;
}
