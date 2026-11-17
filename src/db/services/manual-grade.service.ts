import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { UserActor } from "@/auth/actor";
import { ensurePerm } from "@/auth/permissions";
import { generateToken } from "@/auth/token";
import { InvalidData } from "@/core/error";
import type { QuestionRefId } from "@/core/schemas/base";
import type { CourseRef } from "@/core/schemas/course";
import {
	manualChangeRevert,
	unansweredGrade,
} from "@/core/schemas/manual-grade";
import { submissionSchema } from "@/core/schemas/submission";
import { scoreValue } from "@/core/score";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { touch } from "@/db/conditional-write";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import {
	type GradingPass,
	isManualChange,
	REVERT_REF_PREFIX,
} from "@/services/grading";
import { JsonNull, type Prisma, type PrismaTx } from "../client";
import { attemptOrEmpty } from "../empty-attempt";
import { courseRefWhere, valueOrNotFound } from "../utils";
import { fromDb, type Submission } from "./submission.service";

/// The input of a schema with a course, whose id is branded.
type WithCourse<S extends z.ZodType<{ course: unknown }>> = Omit<
	z.input<S>,
	"course"
> & { course: CourseRef };

/// The relations `fromDb` reads from a submission row.
const submissionInclude = {
	response: { select: { publicId: true } },
	question: { select: { slug: true } },
} satisfies Prisma.SubmissionInclude;

/// The course as `course.update-contents` needs it: its id and instructor.
async function loadCourse(tx: PrismaTx, ref: CourseRef) {
	return valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(ref),
			select: { id: true, instructor: { select: { username: true } } },
		}),
	);
}

/// Whether `score` is a decimal string in [0, 1].
function isStoredScore(score: string): boolean {
	return /^(\d+(\.\d*)?|\.\d+)$/.test(score) && Number(score) <= 1;
}

/** The service of `client` (the shared client by default). */
export const makeManualGradeService = defineService()(() => {
	/**
	 * Grades a question the student left unanswered: creates, in one transaction, the empty attempt when
	 * needed, an `AUTOSAVE` submission with JSON `null` payload, status `GRADED_MANUALLY` and `createdById`,
	 * and a grading pass by the actor with that score.
	 *
	 * Never checks `assertAcceptingSubmissions`; never creates `SUBMIT` or `FINAL`.
	 *
	 * @throws {@link NotFound} course, exam, or a question the exam does not carry (`question`).
	 * @throws {@link NotAllowed} actor lacks `course.update-contents` on the course.
	 * @throws {@link InvalidData} the `attemptOrEmpty` refusals keyed on `author`, with `requireFinished: true`;
	 * keyed on `question` when the attempt already has a submission to that question (use `grading.grade`);
	 * keyed on `score` when it is not a decimal in [0, 1].
	 */
	const gradeUnanswered = op({
		args: [unansweredGrade],
		returns: submissionSchema,
		run: async (
			tx: PrismaTx,
			input: WithCourse<typeof unansweredGrade>,
			opts: ServiceOptsWithoutTx,
		): Promise<Submission> => {
			const course = await loadCourse(tx, input.course);
			ensurePerm(opts.actor, "course.update-contents", course);
			const exam = valueOrNotFound(
				"exam",
				await tx.exam.findUnique({
					where: { courseId_slug: { courseId: course.id, slug: input.exam } },
					select: { id: true },
				}),
			);
			const carried = valueOrNotFound(
				"question",
				await tx.questionsForExam.findFirst({
					where: {
						examId: exam.id,
						questionRef: { slug: input.question, courseId: course.id },
					},
					select: { questionRefId: true },
				}),
			);
			if (!isStoredScore(input.score)) {
				throw new InvalidData({
					score: [{ code: "invalid", message: m.errors_manual_grade_score() }],
				});
			}

			const grader = (opts.actor as UserActor).username;
			const attempt = await attemptOrEmpty(tx, {
				examId: exam.id,
				author: input.author,
				createdBy: grader,
				now: new Date(),
				field: "author",
				requireFinished: true,
			});
			const answered = await tx.submission.findFirst({
				where: { responseId: attempt.id, questionId: carried.questionRefId },
				select: { id: true },
			});
			if (answered) {
				throw new InvalidData({
					question: [
						{
							code: "invalid",
							message: m.errors_manual_grade_answered({
								username: input.author,
							}),
						},
					],
				});
			}

			const row = await tx.submission.create({
				data: {
					publicId: generateToken(9),
					responseId: attempt.id,
					questionId: carried.questionRefId as QuestionRefId,
					payload: JsonNull,
					kind: "AUTOSAVE",
					status: "GRADED_MANUALLY",
					createdById: grader,
				},
				include: submissionInclude,
			});
			await tx.feedback.create({
				data: {
					submissionId: row.id,
					ref: `manual-${randomUUID()}`,
					score: input.score,
					graderId: grader,
					feedback: input.comment?.trim() ? input.comment : null,
				},
			});
			await touch(tx, "response", { id: attempt.id }, {});
			return fromDb(row);
		},
	});

	/**
	 * Undoes a change by hand: writes a pass by the actor whose `ref` starts with `REVERT_REF_PREFIX` and whose score is
	 * the automatic one (`autoScoreOf`), or 0 when the answer has no automatic pass (an instructor-created submission).
	 *
	 * Deletes nothing: the history stays and the new pass is the newest, so `isManualChange` turns false.
	 *
	 * @throws {@link NotFound} the submission, or one that belongs to another course or exam.
	 * @throws {@link NotAllowed} actor lacks `course.update-contents` on the course.
	 * @throws {@link InvalidData} keyed on `submission` when the answer is not a change by hand.
	 */
	const revert = op({
		args: [manualChangeRevert],
		returns: submissionSchema,
		run: async (
			tx: PrismaTx,
			input: WithCourse<typeof manualChangeRevert>,
			opts: ServiceOptsWithoutTx,
		): Promise<Submission> => {
			const course = await loadCourse(tx, input.course);
			ensurePerm(opts.actor, "course.update-contents", course);
			const row = valueOrNotFound(
				"submission",
				await tx.submission.findFirst({
					where: {
						publicId: input.submission,
						response: {
							exam: { slug: input.exam, courseId: course.id },
						},
					},
					include: {
						...submissionInclude,
						feedbacks: {
							select: {
								score: true,
								feedback: true,
								graderId: true,
								botId: true,
								ref: true,
								updatedAt: true,
								id: true,
							},
						},
					},
				}),
			);

			const newestFirst = [...row.feedbacks].sort(
				(a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.id - a.id,
			);
			const passes: GradingPass[] = newestFirst.map((pass) => ({
				score: scoreValue(pass.score),
				comment: pass.feedback,
				grader: pass.graderId,
				bot: pass.botId,
				willNotGrade: false,
				ref: pass.ref,
				updatedAt: pass.updatedAt,
			}));
			if (!isManualChange(passes, row.createdById)) {
				throw new InvalidData({
					submission: [
						{
							code: "invalid",
							message: m.errors_manual_change_not_changed(),
						},
					],
				});
			}

			const automatic = newestFirst.find((pass) => pass.graderId === null);
			await tx.feedback.create({
				data: {
					submissionId: row.id,
					ref: `${REVERT_REF_PREFIX}${randomUUID()}`,
					score: automatic?.score ?? "0",
					graderId: (opts.actor as UserActor).username,
				},
			});
			const updated = await tx.submission.update({
				where: { id: row.id },
				data: { status: "GRADED_MANUALLY" },
				include: submissionInclude,
			});
			await touch(tx, "response", { id: row.responseId }, {});
			return fromDb(updated);
		},
	});

	return { gradeUnanswered, revert };
});
