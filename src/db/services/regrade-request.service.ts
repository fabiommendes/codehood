/**
 * A student's request to review the grade of one answer, and the instructor's answer to it.
 *
 * At most one request exists per submission. The author opens it while the
 * exam's results are visible to them and the regrade window is open, and may
 * withdraw it while it is `OPEN`. The course's instructor resolves it once:
 * accepting writes a new grading pass, which becomes the answer's grade;
 * rejecting only records the reply. A resolved request never changes again.
 *
 * Grading the answer through the regular grading page does not resolve an
 * open request.
 */
import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { type Actor, SYSTEM } from "@/auth/actor";
import {
	ensurePerm,
	hasPerm,
	type ResponseWithCourse,
} from "@/auth/permissions";
import {
	InvalidData,
	NotAllowed,
	NotFound,
	NotImplemented,
} from "@/core/error";
import type { RegradeRequestId, SubmissionId } from "@/core/schemas";
import {
	regradeAccept,
	regradeReject,
	regradeRequestCreate,
	regradeRequestFilter,
	regradeRequestPK,
	regradeRequestSchema,
} from "@/core/schemas";
import {
	CrudBase,
	type ServiceOpts,
	type ServiceOptsWithoutTx,
} from "@/db/base-service";
import { m } from "@/i18n";
import { examResult } from "@/services/exam-result";
import { regradeBlocker, regradeBlockerMessage } from "@/services/regrade";
import { Validate } from "@/utils/validate";
import {
	type Prisma,
	type PrismaClient,
	type PrismaTx,
	prisma,
} from "../client";
import {
	courseRefMatch,
	courseRefWhere,
	exceptionTimings,
	invalidIfExists,
	valueOrNotFound,
} from "../utils";
import type { FeedbackService } from "./feedback.service";
import { examTimingFromDb, examTimingSelect } from "./submission.service";

export type { RegradeRequestId };

//
// Type definitions
//
export type RegradeRequest = z.infer<typeof regradeRequestSchema>;
export type RegradeRequestCreate = z.infer<typeof regradeRequestCreate>;
export type RegradeRequestFilter = z.infer<typeof regradeRequestFilter>;
export type RegradeRequestPK = z.infer<typeof regradeRequestPK>;
export type RegradeAccept = z.infer<typeof regradeAccept>;
export type RegradeReject = z.infer<typeof regradeReject>;

/// The relations a request row needs to build its entity and its permission target.
const requestInclude = {
	resolvedBy: { select: { username: true } },
	submission: {
		select: {
			publicId: true,
			question: { select: { slug: true } },
			response: {
				select: {
					authorId: true,
					exam: {
						select: {
							slug: true,
							course: {
								select: { instructor: { select: { username: true } } },
							},
						},
					},
				},
			},
		},
	},
} satisfies Prisma.RegradeRequestInclude;

type DbRegradeRequest = Prisma.RegradeRequestGetPayload<{
	include: typeof requestInclude;
}>;

/// Converts a database row into the request entity.
function fromDb(row: DbRegradeRequest): RegradeRequest {
	return {
		id: row.id as RegradeRequestId,
		publicId: row.publicId,
		submissionId: row.submissionId as SubmissionId,
		submission: row.submission.publicId,
		exam: row.submission.response.exam.slug,
		question: row.submission.question.slug,
		author: row.submission.response.authorId,
		message: row.message,
		status: row.status,
		reply: row.reply,
		feedbackId: row.feedbackId as RegradeRequest["feedbackId"],
		resolvedBy: row.resolvedBy?.username ?? null,
		resolvedAt: row.resolvedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	};
}

/// The `regrade.*` permission target of a request row; those rules read only the instructor and the author, never the enrollments.
function targetOf(row: DbRegradeRequest): ResponseWithCourse {
	const { response } = row.submission;
	return {
		author: { username: response.authorId },
		course: { ...response.exam.course, enrollments: [] },
	};
}

/// Whether `actor` teaches the course or is SYSTEM.
function teaches(
	actor: Actor,
	course: { instructor: { username: string } },
): boolean {
	return actor === SYSTEM || actor.username === course.instructor.username;
}

/// The `where` matching whichever primary key `filter` carries.
function requestWhere(
	filter: RegradeRequestPK,
): Prisma.RegradeRequestWhereInput {
	if ("id" in filter) return { id: filter.id };
	return {
		publicId: filter.publicId,
		...(filter.course !== undefined && {
			submission: {
				response: { exam: { course: courseRefMatch(filter.course) } },
			},
		}),
	};
}

/// Orders open requests first, oldest first; then resolved ones, newest resolution first; `id` breaks ties.
function byQueueOrder(a: DbRegradeRequest, b: DbRegradeRequest): number {
	const aOpen = a.status === "OPEN";
	if (aOpen !== (b.status === "OPEN")) return aOpen ? -1 : 1;
	if (aOpen) {
		return a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id;
	}
	return (
		(b.resolvedAt?.getTime() ?? 0) - (a.resolvedAt?.getTime() ?? 0) ||
		b.id - a.id
	);
}

/// What `create` loads about the contested answer: its attempt, exam, course and competing answers.
const contestedSelect = {
	id: true,
	questionId: true,
	question: { select: { slug: true } },
	regradeRequest: { select: { id: true } },
	response: {
		select: {
			authorId: true,
			createdAt: true,
			acceptingSubmissions: true,
			exam: {
				select: {
					...examTimingSelect,
					gradesReleasedAt: true,
					exceptions: {
						select: { username: true, extraTimeMs: true, scheduledAt: true },
					},
					course: {
						select: {
							instructor: { select: { username: true } },
							enrollments: {
								where: { status: "ACTIVE" as const },
								select: { username: true },
							},
						},
					},
				},
			},
			submissions: {
				select: {
					id: true,
					publicId: true,
					status: true,
					createdAt: true,
					questionId: true,
					feedbacks: {
						select: { score: true, feedback: true, updatedAt: true },
					},
				},
			},
		},
	},
} satisfies Prisma.SubmissionSelect;

/// Moves the request `id` out of `OPEN` with `data`, refusing when someone else resolved it first.
async function resolve(
	tx: PrismaTx,
	id: RegradeRequestId,
	data: Prisma.RegradeRequestUncheckedUpdateManyInput,
): Promise<RegradeRequest> {
	const { count } = await tx.regradeRequest.updateMany({
		where: { id, status: "OPEN" },
		data,
	});
	if (count === 0) throw resolvedError();
	return fromDb(
		await tx.regradeRequest.findFirstOrThrow({
			where: { id },
			include: requestInclude,
		}),
	);
}

/// The refusal for a request that is no longer `OPEN`.
function resolvedError(): InvalidData {
	return new InvalidData({
		status: [{ code: "invalid", message: m.errors_regrade_resolved() }],
	});
}

/// The username to record for `actor`, or `null` for SYSTEM.
function userOf(actor: Actor): string | null {
	return actor === SYSTEM ? null : actor.username;
}

/// Loads the request of `filter` for a write that needs `perm`, which must still be `OPEN`.
async function openRequest(
	tx: PrismaTx,
	filter: RegradeRequestPK,
	actor: Actor,
	perm: "regrade.request" | "regrade.resolve",
): Promise<DbRegradeRequest> {
	const row = await tx.regradeRequest.findFirst({
		where: requestWhere(filter),
		include: requestInclude,
	});
	if (!row || !hasPerm(actor, "regrade.read", targetOf(row))) {
		throw new NotFound("regrade request");
	}
	ensurePerm(actor, perm, targetOf(row));
	if (row.status !== "OPEN") {
		throw resolvedError();
	}
	return row;
}

/// A new request id, 18 lowercase hex characters.
function newPublicId(): string {
	return randomBytes(9).toString("hex");
}

export class RegradeRequestService extends CrudBase<{
	entity: RegradeRequest;
	pkFilter: RegradeRequestPK;
	create: RegradeRequestCreate;
	filter: RegradeRequestFilter;
	update: never;
	upsert: false;
}> {
	private readonly feedback: FeedbackService;

	constructor(feedback: FeedbackService, client: PrismaClient = prisma) {
		super(client);
		this.feedback = feedback;
	}

	/**
	 * Opens a request by the author of `input.submission`, `OPEN` with `input.message` as the justification.
	 *
	 * The request is refused unless `regradeBlocker` returns `null` for the
	 * submission at the current time, judged on the exam's own timing, every
	 * exception of the exam (`exceptionTimings`, dropped students flagged),
	 * the author's own exception, the author's attempt, and the outcome
	 * `examResult` computes over every submission of the attempt and every
	 * grading pass on it. The `publicId` is 18 lowercase hex characters, so
	 * `regrade-<publicId>` is a valid feedback `ref`.
	 *
	 * @throws {@link NotFound}
	 * If the course or the submission does not exist, the submission belongs
	 * to another course, or `actor` may not read it (`submission.read`).
	 * @throws {@link NotAllowed}
	 * If `actor` may read the submission but lacks `regrade.request` on it
	 * (the course's instructor, for instance).
	 * @throws {@link InvalidData}
	 * If `input.message` is not 10 to 2000 characters after trimming (keyed on
	 * `message`), or a blocker applies (keyed on `submission`, with
	 * `regradeBlockerMessage` as the message; code `not-unique` for `exists`,
	 * `invalid` for every other blocker).
	 */
	@Validate({
		service: true,
		returns: regradeRequestSchema,
		args: [undefined, regradeRequestCreate],
	})
	protected async createTx(
		tx: PrismaTx,
		input: RegradeRequestCreate,
		opts: ServiceOptsWithoutTx,
	): Promise<RegradeRequest> {
		const contested = valueOrNotFound(
			"submission",
			await tx.submission.findFirst({
				where: {
					publicId: input.submission,
					response: { exam: { course: courseRefMatch(input.course) } },
				},
				select: contestedSelect,
			}),
		);
		const { response } = contested;
		const target: ResponseWithCourse = {
			author: { username: response.authorId },
			course: response.exam.course,
		};
		if (!hasPerm(opts.actor, "submission.read", target)) {
			throw new NotFound("submission");
		}
		ensurePerm(opts.actor, "regrade.request", target);

		const now = new Date();
		const exceptions = exceptionTimings(
			response.exam.exceptions,
			response.exam.course.enrollments.map((entry) => entry.username),
		);
		const own = response.exam.exceptions.findIndex(
			(entry) => entry.username === response.authorId,
		);
		const answers = response.submissions.filter(
			(entry) => entry.questionId === contested.questionId,
		);
		const [outcome] = examResult(
			[contested.question.slug],
			answers.map((entry) => ({
				...entry,
				question: contested.question.slug,
			})),
			answers.flatMap((entry) =>
				entry.feedbacks.map((pass) => ({
					...pass,
					submission: entry.publicId,
				})),
			),
		).questions;
		if (!outcome) throw new Error("examResult returned no outcome");

		const blocker = regradeBlocker(
			{
				exam: {
					...examTimingFromDb(response.exam),
					gradesReleasedAt: response.exam.gradesReleasedAt,
				},
				exceptions,
				exception: own === -1 ? null : (exceptions[own] ?? null),
				attempt: response,
				outcome,
				submission: input.submission,
				requested: contested.regradeRequest !== null,
			},
			now,
		);
		if (blocker) {
			throw new InvalidData({
				submission: [
					{
						code: blocker === "exists" ? "not-unique" : "invalid",
						message: regradeBlockerMessage(blocker),
					},
				],
			});
		}

		const row = await invalidIfExists(tx.regradeRequest.create, {
			data: {
				publicId: newPublicId(),
				submissionId: contested.id,
				message: input.message,
			},
			include: requestInclude,
		});
		return fromDb(row);
	}

	/**
	 * Finds a request by `id`, or by `publicId` within the course when one is given.
	 *
	 * Visible to holders of `regrade.read` (the author and the course's
	 * instructor); anyone else gets `null`, exactly as for a missing request.
	 */
	@Validate({
		service: true,
		returns: regradeRequestSchema.nullable(),
		args: [undefined, regradeRequestPK],
	})
	protected async findOneTx(
		tx: PrismaTx,
		filter: RegradeRequestPK,
		opts: ServiceOptsWithoutTx,
	): Promise<RegradeRequest | null> {
		const row = await tx.regradeRequest.findFirst({
			where: requestWhere(filter),
			include: requestInclude,
		});
		if (!row || !hasPerm(opts.actor, "regrade.read", targetOf(row))) {
			return null;
		}
		return fromDb(row);
	}

	/**
	 * Lists the requests of one course, narrowed by `exam`, `status` and `author`, and to what `actor` may read.
	 *
	 * The course's instructor (and SYSTEM) gets every matching request. Any
	 * other actor with `course.read-contents` is narrowed, in the query, to the
	 * requests on their own answers. Every returned row is still checked
	 * against `regrade.read`.
	 *
	 * Ordered `OPEN` first, oldest `createdAt` first; then the resolved ones,
	 * newest `resolvedAt` first; `id` breaks ties.
	 *
	 * @throws {@link NotFound} If the course does not exist.
	 * @throws {@link NotAllowed}
	 * If `actor` may not read the course's contents, or names another student
	 * in `filter.author` while narrowed to their own requests.
	 */
	@Validate({
		service: true,
		returns: regradeRequestSchema.array(),
		args: [undefined, regradeRequestFilter],
	})
	protected async findManyTx(
		tx: PrismaTx,
		filter: RegradeRequestFilter,
		opts: ServiceOptsWithoutTx,
	): Promise<RegradeRequest[]> {
		const course = valueOrNotFound(
			"course",
			await tx.course.findUnique({
				where: courseRefWhere(filter.course),
				select: {
					id: true,
					instructor: { select: { username: true } },
					enrollments: {
						where: { status: "ACTIVE" as const },
						select: { username: true },
					},
				},
			}),
		);
		ensurePerm(opts.actor, "course.read-contents", course);

		let author = filter.author;
		if (!teaches(opts.actor, course)) {
			const self = (opts.actor as { username: string }).username;
			if (author !== undefined && author !== self) {
				throw new NotAllowed("regrade.read");
			}
			author = self;
		}

		const rows = await tx.regradeRequest.findMany({
			where: {
				submission: {
					response: {
						...(author === undefined ? {} : { authorId: author }),
						exam: {
							courseId: course.id,
							...(filter.exam === undefined ? {} : { slug: filter.exam }),
						},
					},
				},
				...(filter.status === undefined ? {} : { status: filter.status }),
			},
			include: requestInclude,
		});
		for (const row of rows)
			ensurePerm(opts.actor, "regrade.read", targetOf(row));
		return rows.sort(byQueueOrder).map(fromDb);
	}

	/// No update: a request moves only through `accept` and `reject`.
	override update<Opt extends ServiceOpts>(
		_filter: RegradeRequestPK,
		_update: never,
		_opts: Opt,
	): Promise<never> {
		throw new NotImplemented("regrade-request.update");
	}

	/// No upsert: a student opens a request once, with `create`.
	override upsert<Opt extends ServiceOpts>(
		_input: never,
		_opts: Opt,
	): Promise<never> {
		throw new NotImplemented("regrade-request.upsert");
	}

	/**
	 * Withdraws a request, deleting its row so its author may open another for the same answer.
	 *
	 * Only `OPEN` requests are withdrawn, and only by their author.
	 *
	 * @throws {@link NotFound}
	 * If no request matches `filter`, or `actor` may not read it.
	 * @throws {@link NotAllowed}
	 * If `actor` may read the request but lacks `regrade.request` on it.
	 * @throws {@link InvalidData}
	 * If the request is already resolved (keyed on `status`, code `invalid`).
	 */
	@Validate({ service: true, args: [undefined, regradeRequestPK] })
	protected async deleteTx(
		tx: PrismaTx,
		filter: RegradeRequestPK,
		opts: ServiceOptsWithoutTx,
	): Promise<void> {
		const row = await openRequest(tx, filter, opts.actor, "regrade.request");
		await tx.regradeRequest.delete({ where: { id: row.id } });
	}

	/**
	 * Accepts an `OPEN` request: writes a new grading pass and marks the request `ACCEPTED`, in one transaction.
	 *
	 * The pass goes through `FeedbackService.create` on the same transaction,
	 * with `ref: regrade-<publicId>`, `score: input.score`, the actor as
	 * grader and `input.reply` (trimmed) as its comment, so it becomes the
	 * answer's current verdict. The score may equal the previous one. The
	 * request gets `reply`, `feedbackId`, `resolvedBy` (the actor) and
	 * `resolvedAt` (now). A failure leaves both the pass and the request
	 * untouched.
	 *
	 * @throws {@link NotFound}
	 * If no request matches `filter`, or `actor` may not read it.
	 * @throws {@link NotAllowed}
	 * If `actor` may read the request but lacks `regrade.resolve` (its author,
	 * or an admin who does not teach the course).
	 * @throws {@link InvalidData}
	 * If `input` is invalid (keyed on `score` or `reply`), or the request is
	 * already resolved (keyed on `status`, code `invalid`).
	 */
	accept<Opt extends ServiceOpts>(
		filter: RegradeRequestPK,
		input: RegradeAccept,
		opts: Opt,
	): Promise<RegradeRequest> {
		return this.$transaction(opts, (tx, scoped) =>
			this.acceptTx(tx, filter, input, scoped),
		);
	}

	/**
	 * Rejects an `OPEN` request with `input.reply`, marking it `REJECTED`; the grade does not move.
	 *
	 * The request gets `reply` (trimmed), `resolvedBy` (the actor) and
	 * `resolvedAt` (now); `feedbackId` stays `null`.
	 *
	 * @throws {@link NotFound}
	 * If no request matches `filter`, or `actor` may not read it.
	 * @throws {@link NotAllowed}
	 * If `actor` may read the request but lacks `regrade.resolve`.
	 * @throws {@link InvalidData}
	 * If `input.reply` is not 1 to 2000 characters after trimming (keyed on
	 * `reply`), or the request is already resolved (keyed on `status`, code
	 * `invalid`).
	 */
	reject<Opt extends ServiceOpts>(
		filter: RegradeRequestPK,
		input: RegradeReject,
		opts: Opt,
	): Promise<RegradeRequest> {
		return this.$transaction(opts, (tx, scoped) =>
			this.rejectTx(tx, filter, input, scoped),
		);
	}

	/// See {@link accept}.
	@Validate({
		service: true,
		returns: regradeRequestSchema,
		args: [undefined, regradeRequestPK, regradeAccept],
	})
	protected async acceptTx(
		tx: PrismaTx,
		filter: RegradeRequestPK,
		input: RegradeAccept,
		opts: ServiceOptsWithoutTx,
	): Promise<RegradeRequest> {
		const row = await openRequest(tx, filter, opts.actor, "regrade.resolve");
		const pass = await this.feedback.create(
			{
				submission: { id: row.submissionId },
				ref: `regrade-${row.publicId}`,
				score: input.score,
				feedback: input.reply,
			},
			{ ...opts, tx },
		);
		return resolve(tx, row.id, {
			status: "ACCEPTED",
			reply: input.reply,
			feedbackId: pass.id,
			resolvedById: userOf(opts.actor),
			resolvedAt: new Date(),
		});
	}

	/// See {@link reject}.
	@Validate({
		service: true,
		returns: regradeRequestSchema,
		args: [undefined, regradeRequestPK, regradeReject],
	})
	protected async rejectTx(
		tx: PrismaTx,
		filter: RegradeRequestPK,
		input: RegradeReject,
		opts: ServiceOptsWithoutTx,
	): Promise<RegradeRequest> {
		const row = await openRequest(tx, filter, opts.actor, "regrade.resolve");
		return resolve(tx, row.id, {
			status: "REJECTED",
			reply: input.reply,
			resolvedById: userOf(opts.actor),
			resolvedAt: new Date(),
		});
	}
}
