/**
 * The `where` fragments that leave the instructor's simulation of an exam out
 * of every read that measures the students' attempts.
 *
 * A simulation is a `Response` with `preview = true`. A reader that starts
 * from `Submission`, `Feedback`, `GradingJob` or `RegradeRequest` reaches it
 * through `response`, so it spreads {@link ofRealAttempts} under that key.
 */

import type { Prisma } from "./client";

/// Matches a `Response` that is a student's attempt, never a simulation.
export const realAttempt = {
	preview: false,
} satisfies Prisma.ResponseWhereInput;

/// Narrows a `Submission` query to the ones of student attempts.
export const ofRealAttempts = {
	response: realAttempt,
} satisfies Prisma.SubmissionWhereInput;

/// Narrows a `Feedback` query to the ones of student attempts.
export const feedbackOfRealAttempts = {
	submission: ofRealAttempts,
} satisfies Prisma.FeedbackWhereInput;

/// The same condition for raw SQL over `ResponseRef`, aliased `alias`.
export function realAttemptSql(alias: string): string {
	return `${alias}.preview = 0`;
}
