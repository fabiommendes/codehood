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
 * Whether a student may run code while answering `exam`.
 *
 * An explicit `allowCodeRun` wins; null follows the exam type: on for
 * `PRACTICE`, off for `QUIZ` and `EXAM`. Only answer mode asks: an
 * instructor reviewing submissions can always run them.
 *
 * @example
 * canRunCode({ type: "PRACTICE", allowCodeRun: null }); // true
 * canRunCode({ type: "EXAM", allowCodeRun: true }); // true
 */
export function canRunCode(_exam: CodeRunSetting): boolean {
	throw new Error("not implemented");
}
