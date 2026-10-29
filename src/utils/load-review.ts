import { FULL_ACCESS } from "@/auth/actor";
import { type Course, db } from "@/db";
import type { ExamResult } from "@/services/exam-result";
import { type ReviewResult, reviewResult } from "@/services/review";

/**
 * Loads the review result of each answered question of a student's released
 * exam, by question slug.
 *
 * Reads the private question documents with full access, since a student may
 * not read them. Only the marks and feedback derived from them leave this
 * function, never the answer key; the caller must only call it once the
 * student may see their grades.
 */
export async function loadReviews(
	course: Course["id"],
	pinned: readonly { slug: string; version: string | null }[],
	result: ExamResult,
	submissions: readonly { publicId: string; payload: unknown }[],
): Promise<Record<string, ReviewResult>> {
	const reviews: Record<string, ReviewResult> = {};
	await Promise.all(
		result.questions.map(async (outcome) => {
			if (outcome.status !== "graded" && outcome.status !== "pending") return;
			const payload = submissions.find(
				(submission) => submission.publicId === outcome.submission,
			)?.payload;
			if (payload === undefined || payload === null) return;
			const stored = await db.question.findOne(
				{
					course,
					slug: outcome.question,
					public: false,
					version:
						pinned.find((entry) => entry.slug === outcome.question)?.version ??
						null,
				},
				FULL_ACCESS,
			);
			if (!stored) return;
			reviews[outcome.question] = reviewResult(stored.question, payload, {
				score: outcome.score,
				blanks: outcome.blanks,
			});
		}),
	);
	return reviews;
}
