import { z } from "zod";
import { questionDocument } from "@/mdq";
import { publicId, slug } from "./base";
import { courseRef } from "./course";
import { submissionKind, submissionStatus } from "./submission";

/// Longest lease a worker may hold or ask for, in milliseconds.
export const MAX_LEASE_MS = 600_000;

/// Lease a worker gets when it does not ask for one, in milliseconds.
export const DEFAULT_LEASE_MS = 120_000;

/// Jobs a single claim may take.
export const MAX_CLAIM_LIMIT = 20;

/// Jobs a claim takes when it does not say.
export const DEFAULT_CLAIM_LIMIT = 4;

/// How many infrastructure failures a job survives before it is `FAILED`.
export const MAX_JOB_ATTEMPTS = 3;

export const gradingJobState = z.enum([
	"QUEUED",
	"CLAIMED",
	"DONE",
	"FAILED",
	"CANCELLED",
]);

const leaseMs = z
	.number()
	.int()
	.min(1)
	.max(MAX_LEASE_MS)
	.default(DEFAULT_LEASE_MS);

/// A worker slug, as `meta.worker` of a code question.
export const workerName = z.string().regex(/^[a-z0-9-]{1,40}$/);

/// What a worker asks for when it pulls jobs. `course` is the Course URL without the leading slash.
export const gradingJobClaim = z.object({
	workers: z.array(workerName).min(1),
	limit: z
		.number()
		.int()
		.min(1)
		.max(MAX_CLAIM_LIMIT)
		.default(DEFAULT_CLAIM_LIMIT),
	leaseMs,
	discipline: slug.optional(),
	course: z.string().min(1).optional().openapi({ example: "cs101/ada_2026-1" }),
	exam: slug.optional(),
	questions: z.array(slug).optional(),
});

/// A job handed to a worker: the private question document, the student's answer and the lease.
export const gradingJobSchema = z.object({
	/// The submission's `publicId`.
	submission: publicId,
	kind: z.enum(["SUBMIT", "FINAL"]),
	worker: workerName,
	question: questionDocument,
	exam: slug,
	course: z.string().openapi({ example: "cs101/ada_2026-1" }),
	student: z.string(),
	answer: z.string(),
	leaseUntil: z.iso.datetime(),
});

/// What a worker asks for to keep a job it holds.
export const gradingJobRenew = z.object({ leaseMs });

/// The new end of the lease.
export const gradingJobRenewed = z.object({ leaseUntil: z.iso.datetime() });

/// A worker that could not grade a job: `retry` counts the attempt, otherwise the job returns untouched.
export const gradingJobFail = z.object({
	error: z.string().min(1).max(4000),
	retry: z.boolean(),
});

/// Where a job stands after a worker gave it up.
export const gradingJobFailed = z.object({ state: gradingJobState });

/// The runner report a worker sends, validated against the question by mdq when it arrives.
export const gradingJobReport = z.unknown().openapi({
	type: "object",
	description: "A runner report, as mdq's runner-report schema defines it.",
});

/// What the server decided about a runner report.
export const gradingJobResult = z.object({
	state: gradingJobState,
	status: submissionStatus,
	/// Present when the report was graded.
	score: z.number().optional(),
});

/// Names the question whose jobs a professor manages.
export const gradingJobQueue = z.object({
	course: courseRef,
	exam: slug,
	question: slug,
});

/// How many jobs of a queue `requeueFailed` put back.
export const gradingJobRequeued = z.object({
	requeued: z.number().int().min(0),
});

/// The state of a question's queue and the workers that serve it.
export const gradingJobSummary = z.object({
	counts: z.record(gradingJobState, z.number().int().min(0)),
	failures: z.array(
		z.object({
			submission: publicId,
			student: z.string(),
			attempts: z.number().int(),
			lastError: z.string().nullable(),
		}),
	),
	/// The professor's `BOT` keys and when each was last used.
	keys: z.array(
		z.object({ name: z.string(), lastUsedAt: z.date().nullable() }),
	),
});

/// Names the answer and question whose submissions a student looks up.
export const gradingJobStudentQuery = z.object({
	response: publicId,
	question: slug,
});

/// What a student may see of a runner report, see `studentReportView`.
export const studentReportViewSchema = z.object({
	outcome: z.enum(["retry", "pretest-failed", "graded"]),
	publicCases: z.array(
		z.object({
			source: z.number().int(),
			line: z.number().int(),
			verdict: z.string(),
			id: z.string().optional(),
			message: z.string().optional(),
		}),
	),
	build: z.string().optional(),
	items: z
		.array(
			z.object({
				text: z.string(),
				passed: z.boolean(),
				feedback: z.string().optional(),
			}),
		)
		.optional(),
	score: z.number().optional(),
});

/// A student's sent submissions of one question, with the attempts they have left.
export const gradingJobStudentView = z.object({
	/// Graded submissions allowed in an attempt.
	attempts: z.number().int(),
	/// `null` in a practice exam, where sending is unlimited.
	attemptsLeft: z.number().int().nullable(),
	submissions: z.array(
		z.object({
			submission: publicId,
			kind: submissionKind,
			createdAt: z.date(),
			jobState: gradingJobState.nullable(),
			status: submissionStatus,
			report: studentReportViewSchema.optional(),
		}),
	),
});

/// Names the question and the answers whose sent submissions an instructor reads, all of one course.
export const gradingJobInstructorQuery = z.object({
	question: slug,
	responses: z.array(publicId).max(500),
});

/// The sent submissions of one answer to a question, as the instructor sees them.
export const gradingJobInstructorView = z.record(
	z.string(),
	z.object({
		/// Graded submissions allowed in an attempt.
		attempts: z.number().int(),
		/// Discount per earlier wrong submission; 0 in a practice exam.
		penalty: z.number(),
		submissions: z.array(
			z.object({
				submission: publicId,
				kind: submissionKind,
				createdAt: z.date(),
				jobState: gradingJobState.nullable(),
				lastError: z.string().optional(),
				status: submissionStatus,
				/// The submission's grade in `[-1, 1]`, before the discount.
				score: z.number().optional(),
				/// The grade after the discount for earlier wrong submissions, floored at 0.
				discounted: z.number().optional(),
				/// Whether this submission gives the question's score.
				counts: z.boolean().optional(),
				/// The runner report as the worker sent it, hidden cases included.
				report: gradingJobReport.optional(),
			}),
		),
	}),
);
