/**
 * Routes of the grading job queue, used by external grading workers.
 *
 * Only an actor authenticated by a `BOT` API key may call them; the service
 * enforces that and the rest of the rules. The wire speaks leases in seconds,
 * the service in milliseconds.
 */

import { z } from "zod";
import * as schema from "@/core/schemas";
import { db } from "@/db";
import { POST } from "./registry";

const tags = ["Grading Jobs"];

const lease = z
	.number()
	.int()
	.min(1)
	.max(schema.MAX_LEASE_MS / 1000)
	.default(schema.DEFAULT_LEASE_MS / 1000)
	.openapi({ description: "Lease length in seconds." });

const claimBody = schema.gradingJobClaim
	.omit({ leaseMs: true })
	.extend({ lease });

const renewBody = z.object({ lease });

const submissionParam = (params: Record<string, string>) =>
	schema.publicId.parse(params.submission);

export const gradingJobApi = {
	claim: POST("/api/grading-jobs/claim", {
		in: claimBody,
		out: z.object({ jobs: schema.gradingJobSchema.array() }),
		summary: "Claim grading jobs",
		description:
			"Takes up to `limit` queued jobs of the listed workers, in the courses the key's owner teaches, and holds them for the key for `lease` seconds. Only BOT keys.",
		operationId: "claimGradingJobs",
		tags,
		handler: async ({ actor, body }) => {
			const { lease, ...rest } = body;
			const jobs = await db.gradingJob.claim(
				{ ...rest, leaseMs: lease * 1000 },
				{ actor },
			);
			return { jobs };
		},
	}),
	renew: POST("/api/grading-jobs/[submission]/renew", {
		in: renewBody,
		out: schema.gradingJobRenewed,
		summary: "Renew the lease of a grading job",
		description:
			"Extends a lease the key holds. 409 when the key does not hold the job. Only BOT keys.",
		operationId: "renewGradingJob",
		tags,
		handler: async ({ actor, body, params }) =>
			db.gradingJob.renew(
				submissionParam(params),
				{ leaseMs: body.lease * 1000 },
				{ actor },
			),
	}),
	fail: POST("/api/grading-jobs/[submission]/fail", {
		in: schema.gradingJobFail,
		out: schema.gradingJobFailed,
		summary: "Give up a grading job",
		description:
			"Reports that the worker could not grade the job. With `retry` the attempt counts; without it the job returns to the queue untouched. 409 when the key does not hold the job. Only BOT keys.",
		operationId: "failGradingJob",
		tags,
		handler: async ({ actor, body, params }) =>
			db.gradingJob.fail(submissionParam(params), body, { actor }),
	}),
	result: POST("/api/grading-jobs/[submission]/result", {
		in: schema.gradingJobReport,
		out: schema.gradingJobResult,
		summary: "Report the result of a grading job",
		description:
			"Sends the runner report. The server validates it against the question: 400 when invalid, 409 when the key does not hold the job or the job is closed. Only BOT keys.",
		operationId: "reportGradingJob",
		tags,
		handler: async ({ actor, body, params }) =>
			db.gradingJob.complete(submissionParam(params), body, { actor }),
	}),
};
