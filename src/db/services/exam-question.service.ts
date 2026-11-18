/**
 * What a student reads of an exam's questions, through the exam grant.
 */
import { z } from "zod";
import { slug } from "@/core/schemas/base";
import {
	attemptQuestionsSchema,
	examAttemptRef,
	reviewOutcomes,
	reviewResultSchema,
} from "@/core/schemas/exam-question";
import { codeQuestionMeta } from "@/core/schemas/question";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import {
	type ReviewResult,
	reviewResult,
	type StoredGrade,
} from "@/services/review";
import { pretestSources } from "@/utils/pretest-sources";
import type { PrismaTx } from "../client";
import {
	grantedDocument,
	grantedQuestions,
	issueExamGrant,
} from "./exam-questions";

export type ExamAttemptRef = z.infer<typeof examAttemptRef>;
export type AttemptQuestions = z.infer<typeof attemptQuestionsSchema>;
export type ReviewResults = Record<string, ReviewResult>;

export const makeExamQuestionService = defineService()(() => {
	/**
	 * The questions of the actor's attempt at the exam, in exam order, in the public form with no `tags`, or `null` when the actor has no grant.
	 *
	 * A code question also carries its pretest sources, only while the attempt answers, and whether it goes to a worker.
	 */
	const forAttempt = op({
		args: [examAttemptRef],
		returns: attemptQuestionsSchema.nullable(),
		run: async (
			tx: PrismaTx,
			target: ExamAttemptRef,
			opts: ServiceOptsWithoutTx,
		): Promise<AttemptQuestions | null> => {
			const grant = await issueExamGrant(tx, target, opts.actor);
			if (!grant) return null;
			const granted = await grantedQuestions(tx, grant, opts.actor);
			const questions = await Promise.all(
				granted.map(async ({ slug, version, question }) => {
					const item = {
						slug,
						version,
						weight: question.weight ?? 1,
						question,
					};
					if (question.type !== "code") return item;
					const document = await grantedDocument(tx, grant, opts.actor, slug);
					if (document.type !== "code") return item;
					return {
						...item,
						code: {
							pretests: grant.answering ? pretestSources(document) : [],
							sendable: codeQuestionMeta.parse(document.meta).worker !== null,
						},
					};
				}),
			);
			return { view: grant.view, answering: grant.answering, questions };
		},
	});

	/**
	 * What the review of the actor's attempt shows for each answered question, by slug; `{}` unless the grant has the `review` view.
	 *
	 * The scores come from the caller. A result for a submission that is not of the grant's attempt is left out.
	 */
	const reviews = op({
		args: [examAttemptRef, reviewOutcomes],
		returns: z.record(slug, reviewResultSchema),
		run: async (
			tx: PrismaTx,
			target: ExamAttemptRef,
			outcomes: z.infer<typeof reviewOutcomes>,
			opts: ServiceOptsWithoutTx,
		): Promise<ReviewResults> => {
			const grant = await issueExamGrant(tx, target, opts.actor);
			if (grant?.view !== "review" || grant.responseId === null) {
				return {};
			}
			const own = await tx.submission.findMany({
				where: {
					responseId: grant.responseId,
					publicId: { in: outcomes.map((outcome) => outcome.submission) },
				},
				select: { publicId: true, payload: true },
			});
			const payloads = new Map(own.map((row) => [row.publicId, row.payload]));
			const inGrant = new Set(grant.questions.map((q) => q.slug));
			const results: ReviewResults = {};
			for (const outcome of outcomes) {
				const payload = payloads.get(outcome.submission);
				if (payload === undefined || payload === null) continue;
				if (!inGrant.has(outcome.question)) continue;
				const document = await grantedDocument(
					tx,
					grant,
					opts.actor,
					outcome.question,
				);
				results[outcome.question] = reviewResult(document, payload, {
					score: outcome.score,
					blanks: outcome.blanks as StoredGrade["blanks"],
				});
			}
			return results;
		},
	});

	/** The title of each question of the actor's grant, by slug; `{}` without a grant. */
	const titles = op({
		args: [examAttemptRef],
		returns: z.record(slug, z.string()),
		run: async (
			tx: PrismaTx,
			target: ExamAttemptRef,
			opts: ServiceOptsWithoutTx,
		): Promise<Record<string, string>> => {
			const grant = await issueExamGrant(tx, target, opts.actor);
			if (!grant) return {};
			const granted = await grantedQuestions(tx, grant, opts.actor);
			return Object.fromEntries(
				granted.map(({ slug, question }) => [slug, question.title ?? slug]),
			);
		},
	});

	return { forAttempt, reviews, titles };
});
