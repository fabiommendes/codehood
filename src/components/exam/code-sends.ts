import type { z } from "zod";
import type { studentReportViewSchema } from "@/core/schemas";

/// What a student may see of a worker's report, as the server sends it.
export type StudentReport = z.infer<typeof studentReportViewSchema>;

/// One send of a code answer, as the student's page shows it.
export interface SentView {
	submission: string;
	/// The state of its grading job; `null` when it has none.
	jobState: "QUEUED" | "CLAIMED" | "DONE" | "FAILED" | "CANCELLED" | null;
	/// What the worker made of it, once the job is done and the exam lets the student see it.
	report?: StudentReport;
}

/// What the answer of a code question shows about its sends to a worker.
export interface CodeSends {
	/// Attempts spent so far.
	used: number;
	/// Attempts the question allows; `null` where sending is unlimited (practice).
	limit: number | null;
	/// The sends, oldest first.
	submissions: SentView[];
}

/// The sends of a question as `db.gradingJob.forStudent` reads them.
export interface SentRead {
	attempts: number;
	attemptsLeft: number | null;
	submissions: readonly SentView[];
}

/**
 * The counter and the list of a code question from the sends the server read.
 *
 * @example
 * sendsOf({ attempts: 4, attemptsLeft: 3, submissions: [] }).used // 1
 * sendsOf({ attempts: 4, attemptsLeft: null, submissions: [] }).limit // null
 */
export function sendsOf(sent: SentRead): CodeSends {
	const submissions = sent.submissions.map(
		({ submission, jobState, report }): SentView => ({
			submission,
			jobState,
			...(report ? { report } : {}),
		}),
	);
	return sent.attemptsLeft === null
		? { used: submissions.length, limit: null, submissions }
		: {
				used: sent.attempts - sent.attemptsLeft,
				limit: sent.attempts,
				submissions,
			};
}

/// Whether some send still waits for its worker, so the page keeps asking.
export function hasPendingSend(sends: CodeSends | undefined): boolean {
	return (
		sends?.submissions.some(
			(sent) => sent.jobState === "QUEUED" || sent.jobState === "CLAIMED",
		) ?? false
	);
}
