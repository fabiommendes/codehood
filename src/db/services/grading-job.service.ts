/**
 * The queue of submissions waiting for an external worker.
 *
 * A worker authenticated by a `BOT` API key claims jobs, holds a lease on each
 * while it grades, and reports a runner report or a failure. Every transition
 * is a compare-and-swap on the job's state (and holder), so two workers never
 * share a job. The job's owner is the instructor of the course: the key's
 * owner has to teach a course to take its jobs.
 */
import type { z } from "zod";
import type { Actor, UserActor } from "@/auth/actor";
import { ensurePerm } from "@/auth/permissions";
import {
	ImproperBehavior,
	InvalidData,
	NotAllowed,
	NotFound,
} from "@/core/error";
import {
	DEFAULT_CLAIM_LIMIT,
	DEFAULT_LEASE_MS,
	gradingJobClaim,
	gradingJobFail,
	gradingJobFailed,
	gradingJobQueue,
	gradingJobRenew,
	gradingJobRenewed,
	gradingJobReport,
	gradingJobRequeued,
	gradingJobResult,
	gradingJobSchema,
	gradingJobStudentQuery,
	gradingJobStudentView,
	gradingJobSummary,
	MAX_JOB_ATTEMPTS,
	publicId,
} from "@/core/schemas";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { touch } from "@/db/conditional-write";
import { defineService, op } from "@/db/define-service";
import { m } from "@/i18n";
import type { CodeQuestion, QuestionDocument } from "@/mdq";
import {
	DEFAULT_CODE_ATTEMPTS,
	decideReport,
	type SentSubmission,
	spentAttempts,
	studentReportView,
} from "@/services/code-grading";
import { parseCourseParams } from "@/urls";
import type { Prisma, PrismaTx } from "../client";
import { courseRefWhere, valueOrNotFound } from "../utils";
import {
	examReleaseSelect,
	makeFeedbackService,
	releasedToStudents,
} from "./feedback.service";
import { promoteExpiredSends } from "./grading-job-queue";

//
// Type definitions
//
export type GradingJobClaim = z.input<typeof gradingJobClaim>;
export type GradingJobRenew = z.input<typeof gradingJobRenew>;
export type GradingJobFail = z.infer<typeof gradingJobFail>;
export type GradingJobQueue = z.infer<typeof gradingJobQueue>;
export type GradingJobStudentQuery = z.infer<typeof gradingJobStudentQuery>;
export type Job = z.infer<typeof gradingJobSchema>;
export type GradingJobResult = z.infer<typeof gradingJobResult>;
export type GradingJobSummary = z.infer<typeof gradingJobSummary>;
export type GradingJobStudentView = z.infer<typeof gradingJobStudentView>;

/// What a job needs from its submission, response, exam and course.
const jobInclude = {
	submission: {
		select: {
			id: true,
			publicId: true,
			kind: true,
			status: true,
			payload: true,
			responseId: true,
			question: { select: { id: true, latestId: true } },
			response: {
				select: {
					authorId: true,
					exam: {
						select: {
							id: true,
							slug: true,
							course: {
								select: {
									disciplineSlug: true,
									instructorId: true,
									editionSlug: true,
								},
							},
						},
					},
				},
			},
		},
	},
} satisfies Prisma.GradingJobInclude;

type DbJob = Prisma.GradingJobGetPayload<{ include: typeof jobInclude }>;

/** The service of `client` (the shared client by default). */
export const makeGradingJobService = defineService()((client) => {
	const feedback = makeFeedbackService(client);

	/**
	 * Gives back the jobs whose lease ran out, then takes up to `limit` queued
	 * jobs of the listed workers for the bot, oldest first.
	 *
	 * Only courses the key's owner teaches count. First it sends the last autosave of the attempts that timed out unsent. A job another claim took
	 * first is skipped.
	 *
	 * @throws {@link NotAllowed} The actor is not authenticated by a `BOT` key.
	 * @throws {@link InvalidData} The `course` is not a Course URL.
	 */
	const claim = op({
		args: [gradingJobClaim],
		returns: gradingJobSchema.array(),
		run: async (
			tx: PrismaTx,
			input: GradingJobClaim,
			opts: ServiceOptsWithoutTx,
		): Promise<Job[]> => {
			const bot = botName(opts.actor);
			const owner = (opts.actor as UserActor).username;
			const now = new Date();
			await tx.gradingJob.updateMany({
				where: { state: "CLAIMED", leaseUntil: { lt: now } },
				data: { state: "QUEUED", claimedBy: null, leaseUntil: null },
			});

			const courseUrl =
				input.course === undefined ? null : parseUrl(input.course);
			if (courseUrl !== null && courseUrl.instructor !== owner) return [];

			await promoteExpiredSends(tx, {
				instructor: owner,
				workers: input.workers,
				...(input.questions ? { questions: input.questions } : {}),
				...(input.exam ? { exam: input.exam } : {}),
				course: {
					...(input.discipline ? { disciplineSlug: input.discipline } : {}),
					...(courseUrl
						? {
								disciplineSlug: courseUrl.discipline,
								editionSlug: courseUrl.edition,
							}
						: {}),
				},
			});

			const rows = await tx.gradingJob.findMany({
				where: {
					state: "QUEUED",
					worker: { in: input.workers },
					submission: {
						...(input.questions
							? { question: { slug: { in: input.questions } } }
							: {}),
						response: {
							exam: {
								...(input.exam ? { slug: input.exam } : {}),
								course: {
									instructorId: owner,
									...(input.discipline
										? { disciplineSlug: input.discipline }
										: {}),
									...(courseUrl
										? {
												disciplineSlug: courseUrl.discipline,
												editionSlug: courseUrl.edition,
											}
										: {}),
								},
							},
						},
					},
				},
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				take: input.limit ?? DEFAULT_CLAIM_LIMIT,
				include: jobInclude,
			});

			const leaseUntil = new Date(
				now.getTime() + (input.leaseMs ?? DEFAULT_LEASE_MS),
			);
			const jobs: Job[] = [];
			for (const row of rows) {
				const { count } = await tx.gradingJob.updateMany({
					where: { id: row.id, state: "QUEUED" },
					data: { state: "CLAIMED", claimedBy: bot, leaseUntil },
				});
				if (count === 0) continue;
				jobs.push(await toJob(tx, row, leaseUntil));
			}
			return jobs;
		},
	});

	/**
	 * Extends the lease of a job the bot holds, and returns when it now ends.
	 *
	 * @throws {@link NotAllowed} The actor is no `BOT` key, or its owner does not teach the course; status 409 when the bot does not hold the job.
	 * @throws {@link NotFound} No job for the submission.
	 */
	const renew = op({
		args: [publicId, gradingJobRenew],
		returns: gradingJobRenewed,
		run: async (
			tx: PrismaTx,
			submission: string,
			input: GradingJobRenew,
			opts: ServiceOptsWithoutTx,
		): Promise<{ leaseUntil: string }> => {
			const { job, bot } = await heldJob(tx, submission, opts.actor);
			const leaseUntil = new Date(
				Date.now() + (input.leaseMs ?? DEFAULT_LEASE_MS),
			);
			await swap(tx, job, bot, { leaseUntil });
			return { leaseUntil: leaseUntil.toISOString() };
		},
	});

	/**
	 * Gives up a job the bot holds: with `retry` the attempt counts and the job is `FAILED` at the third, without it the job simply returns to the queue.
	 *
	 * @throws {@link NotAllowed} The actor is no `BOT` key, or its owner does not teach the course; status 409 when the bot does not hold the job.
	 * @throws {@link NotFound} No job for the submission.
	 */
	const fail = op({
		args: [publicId, gradingJobFail],
		returns: gradingJobFailed,
		run: async (
			tx: PrismaTx,
			submission: string,
			input: GradingJobFail,
			opts: ServiceOptsWithoutTx,
		): Promise<{ state: DbJob["state"] }> => {
			const { job, bot } = await heldJob(tx, submission, opts.actor);
			return { state: await giveUp(tx, job, bot, input) };
		},
	});

	/**
	 * Applies a runner report to the job the bot holds: a retry, a failed pretest, or a grade written as the bot's own pass.
	 *
	 * The report is kept on the submission whatever it decided.
	 *
	 * @throws {@link NotAllowed} The actor is no `BOT` key, or its owner does not teach the course; status 409 when the bot does not hold the job.
	 * @throws {@link NotFound} No job for the submission.
	 * @throws {@link InvalidData} The report is invalid or does not serve the question.
	 */
	const complete = op({
		args: [publicId, gradingJobReport],
		returns: gradingJobResult,
		run: async (
			tx: PrismaTx,
			submission: string,
			report: unknown,
			opts: ServiceOptsWithoutTx,
		): Promise<GradingJobResult> => {
			const { job, bot } = await heldJob(tx, submission, opts.actor);
			const { submission: sent } = job;
			const question = await codeDocument(tx, job);
			const decision = decideReport(question, report);

			await tx.submission.update({
				where: { id: sent.id },
				data: { runnerReport: report as Prisma.InputJsonValue },
			});

			if (decision.outcome === "retry") {
				const state = await giveUp(tx, job, bot, {
					error: decision.error,
					retry: true,
				});
				return { state, status: sent.status };
			}

			await swap(tx, job, bot, { state: "DONE", leaseUntil: null });
			if (decision.outcome === "pretest-failed") {
				await tx.submission.update({
					where: { id: sent.id },
					data: { status: "PRETEST_FAILED" },
				});
				await touch(tx, "response", { id: sent.responseId }, {});
				return { state: "DONE", status: "PRETEST_FAILED" };
			}

			await feedback.create(
				{
					submission: { id: sent.id },
					ref: bot,
					score: scoreText(decision.score),
					feedback: decision.feedback,
				},
				{ actor: opts.actor, tx },
			);
			return {
				state: "DONE",
				status: "GRADED_AUTOMATICALLY",
				score: decision.score,
			};
		},
	});

	/**
	 * Puts the failed jobs of a question back in the queue with their attempts cleared, and returns how many.
	 *
	 * @throws {@link NotFound} No such course.
	 * @throws {@link NotAllowed} The actor does not teach the course.
	 */
	const requeueFailed = op({
		args: [gradingJobQueue],
		returns: gradingJobRequeued,
		run: async (
			tx: PrismaTx,
			input: GradingJobQueue,
			opts: ServiceOptsWithoutTx,
		): Promise<{ requeued: number }> => {
			const course = await managedCourse(tx, input, opts.actor);
			const { count } = await tx.gradingJob.updateMany({
				where: { state: "FAILED", submission: queueMatch(course.id, input) },
				data: {
					state: "QUEUED",
					attempts: 0,
					lastError: null,
					claimedBy: null,
					leaseUntil: null,
				},
			});
			return { requeued: count };
		},
	});

	/**
	 * The jobs of a question by state, the failed ones with their error, and when the instructor's `BOT` keys were last used.
	 *
	 * @throws {@link NotFound} No such course.
	 * @throws {@link NotAllowed} The actor does not teach the course.
	 */
	const summary = op({
		transaction: false,
		args: [gradingJobQueue],
		returns: gradingJobSummary,
		run: async (
			tx: PrismaTx,
			input: GradingJobQueue,
			opts: ServiceOptsWithoutTx,
		): Promise<GradingJobSummary> => {
			const course = await managedCourse(tx, input, opts.actor);
			const where = { submission: queueMatch(course.id, input) };
			const [grouped, failed, keys] = await Promise.all([
				tx.gradingJob.groupBy({
					by: ["state"],
					where,
					_count: { _all: true },
				}),
				tx.gradingJob.findMany({
					where: { ...where, state: "FAILED" },
					select: {
						attempts: true,
						lastError: true,
						submission: {
							select: {
								publicId: true,
								response: { select: { authorId: true } },
							},
						},
					},
					orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
				}),
				tx.apiKey.findMany({
					where: { kind: "BOT", createdById: course.instructor.username },
					select: { name: true, lastUsedAt: true },
					orderBy: { name: "asc" },
				}),
			]);
			const counts = {
				QUEUED: 0,
				CLAIMED: 0,
				DONE: 0,
				FAILED: 0,
				CANCELLED: 0,
			};
			for (const row of grouped) counts[row.state] = row._count._all;
			return {
				counts,
				failures: failed.map((row) => ({
					submission: row.submission.publicId,
					student: row.submission.response.authorId,
					attempts: row.attempts,
					lastError: row.lastError,
				})),
				keys,
			};
		},
	});

	/**
	 * A student's sent submissions of one question, each with its job state and what the student may see of its report, and the attempts left.
	 *
	 * @throws {@link NotFound} No such answer or question.
	 * @throws {@link NotAllowed} The actor is not the author of the answer.
	 */
	const forStudent = op({
		transaction: false,
		args: [gradingJobStudentQuery],
		returns: gradingJobStudentView,
		run: async (
			tx: PrismaTx,
			input: GradingJobStudentQuery,
			opts: ServiceOptsWithoutTx,
		): Promise<GradingJobStudentView> => {
			const response = valueOrNotFound(
				"response",
				await tx.response.findUnique({
					where: { publicId: input.response },
					select: {
						id: true,
						authorId: true,
						exam: {
							select: { id: true, ...examReleaseSelect() },
						},
					},
				}),
			);
			const { exam } = response;
			ensurePerm(opts.actor, "grading-job.read", {
				id: response.id,
				author: { username: response.authorId },
				course: exam.course,
			});

			const question = valueOrNotFound(
				"question",
				await tx.questionRef.findFirst({
					where: { courseId: exam.courseId, slug: input.question },
					select: { id: true, latestId: true, attempts: true },
				}),
			);
			const rows = await tx.submission.findMany({
				where: {
					responseId: response.id,
					questionId: question.id,
					kind: { in: ["SUBMIT", "FINAL"] },
				},
				select: {
					publicId: true,
					kind: true,
					status: true,
					createdAt: true,
					runnerReport: true,
					gradingJob: { select: { state: true } },
				},
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			});

			const attempts = question.attempts ?? DEFAULT_CODE_ATTEMPTS;
			const document = await codeDocument(tx, {
				examId: exam.id,
				question,
			});
			const visibility = {
				mode: exam.type,
				attempts,
				released: releasedToStudents(exam, new Date()),
			};
			const sent: SentSubmission[] = rows.map((row) => ({
				kind: row.kind,
				status: row.status,
				jobState: row.gradingJob?.state ?? null,
			}));
			return {
				attempts,
				attemptsLeft:
					exam.type === "PRACTICE"
						? null
						: Math.max(0, attempts - spentAttempts(sent)),
				submissions: rows.map((row) => {
					const view =
						row.gradingJob?.state === "DONE" && row.runnerReport !== null
							? reportView(document, row.runnerReport, visibility)
							: undefined;
					return {
						submission: row.publicId,
						kind: row.kind,
						createdAt: row.createdAt,
						jobState: row.gradingJob?.state ?? null,
						status: row.status,
						...(view ? { report: view } : {}),
					};
				}),
			};
		},
	});

	return { claim, renew, fail, complete, requeueFailed, summary, forStudent };
});

/** The service, as built by {@link makeGradingJobService}. */
export type GradingJobService = ReturnType<typeof makeGradingJobService>;

// Private utilities -----------------------------------------------------------

/// The bot name of `actor`, which must be authenticated by a `BOT` key.
function botName(actor: Actor): string {
	const { bot } = actor as UserActor;
	ensurePerm(actor, "grading-job.work", { bot });
	return bot as string;
}

/// A 409: the job is not the bot's to touch.
function conflict(message: string): NotAllowed {
	return new NotAllowed("grading-job.work", { status: 409, message });
}

/// The job of a submission as the bot holds it, or the 409 that says it does not.
async function heldJob(
	tx: PrismaTx,
	submission: string,
	actor: Actor,
): Promise<{ job: DbJob; bot: string }> {
	const bot = botName(actor);
	const job = valueOrNotFound(
		"grading-job",
		await tx.gradingJob.findFirst({
			where: { submission: { publicId: submission } },
			include: jobInclude,
		}),
	);
	const course = job.submission.response.exam.course;
	if (course.instructorId !== (actor as UserActor).username) {
		throw new NotAllowed("grading-job.work");
	}
	if (
		job.state === "DONE" ||
		job.state === "FAILED" ||
		job.state === "CANCELLED"
	) {
		throw conflict(m.errors_grading_job_closed());
	}
	if (job.state !== "CLAIMED" || job.claimedBy !== bot) {
		throw conflict(m.errors_grading_job_not_held());
	}
	return { job, bot };
}

/// Writes `data` on a job the bot holds, refusing with a 409 when it stopped holding it meanwhile.
async function swap(
	tx: PrismaTx,
	job: DbJob,
	bot: string,
	data: Prisma.GradingJobUpdateManyMutationInput,
): Promise<void> {
	const { count } = await tx.gradingJob.updateMany({
		where: { id: job.id, state: "CLAIMED", claimedBy: bot },
		data,
	});
	if (count === 0) throw conflict(m.errors_grading_job_not_held());
}

/// Releases a held job: it returns to the queue, or is `FAILED` once it spent its attempts. Returns the new state.
async function giveUp(
	tx: PrismaTx,
	job: DbJob,
	bot: string,
	input: { error: string; retry: boolean },
): Promise<DbJob["state"]> {
	const attempts = job.attempts + (input.retry ? 1 : 0);
	const state = attempts >= MAX_JOB_ATTEMPTS ? "FAILED" : "QUEUED";
	await swap(tx, job, bot, {
		state,
		attempts,
		leaseUntil: null,
		...(input.retry ? { lastError: input.error } : {}),
		// A failed job keeps its holder for the record; a queued one has none.
		...(state === "QUEUED" ? { claimedBy: null } : {}),
	});
	return state;
}

/// The private document of the version of the question that the exam pins, or the latest.
async function privateDocument(
	tx: PrismaTx,
	examId: number,
	question: { id: number; latestId: number | null },
): Promise<QuestionDocument> {
	const inExam = await tx.questionsForExam.findUnique({
		where: { examId_questionRefId: { examId, questionRefId: question.id } },
		select: { version: true },
	});
	const data = valueOrNotFound(
		"question-version",
		await tx.questionData.findFirst({
			where: inExam?.version
				? { refId: question.id, versionHash: inExam.version }
				: { id: question.latestId ?? -1 },
			select: { privatePayload: true },
		}),
	);
	return data.privatePayload as unknown as QuestionDocument;
}

/// The code question a job grades.
async function codeDocument(
	tx: PrismaTx,
	job:
		| { examId: number; question: { id: number; latestId: number | null } }
		| DbJob,
): Promise<CodeQuestion> {
	const examId = "examId" in job ? job.examId : job.submission.response.exam.id;
	const question = "examId" in job ? job.question : job.submission.question;
	const document = await privateDocument(tx, examId, question);
	if (document.type !== "code") {
		throw new ImproperBehavior("a grading job points at a non-code question");
	}
	return document;
}

/// The job a worker receives for a claimed row.
async function toJob(tx: PrismaTx, row: DbJob, leaseUntil: Date): Promise<Job> {
	const { submission } = row;
	const { exam } = submission.response;
	const { course } = exam;
	return {
		submission: submission.publicId,
		kind: submission.kind as Job["kind"],
		worker: row.worker,
		question: await codeDocument(tx, row),
		exam: exam.slug,
		course: `${course.disciplineSlug}/${course.instructorId}_${course.editionSlug}`,
		student: submission.response.authorId,
		answer: typeof submission.payload === "string" ? submission.payload : "",
		leaseUntil: leaseUntil.toISOString(),
	};
}

/// The submissions of one question of one exam in a course.
function queueMatch(
	courseId: number,
	input: { exam: string; question: string },
): Prisma.SubmissionWhereInput {
	return {
		question: { courseId, slug: input.question },
		response: { exam: { courseId, slug: input.exam } },
	};
}

/// The course of a queue, which the actor must teach.
async function managedCourse(
	tx: PrismaTx,
	input: GradingJobQueue,
	actor: Actor,
) {
	const course = valueOrNotFound(
		"course",
		await tx.course.findUnique({
			where: courseRefWhere(input.course),
			select: { id: true, instructor: { select: { username: true } } },
		}),
	);
	ensurePerm(actor, "grading-job.manage", course);
	return course;
}

/// The Course URL `<discipline>/<instructor>_<edition>` split into its parts.
function parseUrl(url: string) {
	const [discipline = "", ...rest] = url.split("/");
	return parseCourseParams({ discipline, course: rest.join("/") });
}

/// A score as the exact decimal text a pass stores, without float noise or an exponent.
function scoreText(value: number): string {
	if (Math.abs(value) < 5e-10) return "0";
	return value.toFixed(9).replace(/\.?0+$/, "");
}

/// What the student may see of a stored report, or nothing if it no longer fits the question.
function reportView(
	document: CodeQuestion,
	report: unknown,
	visibility: Parameters<typeof studentReportView>[2],
) {
	try {
		return studentReportView(document, report, visibility);
	} catch (error) {
		if (error instanceof InvalidData) return undefined;
		throw error;
	}
}
