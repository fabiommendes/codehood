/**
 * The edit history of open answers: what a student's browser recorded while
 * typing, stored for the graders (spec
 * `dev/specs/to-review/historico-de-edicao-no-servidor.md`).
 *
 * Nothing here reads or writes `Submission`, and no operation shares a
 * transaction with the answer path: a failure of the history never reaches an
 * answer. Decoding, validation, replay and hashing run outside any transaction;
 * the one that writes only compares the revision it saw, inserts and counts.
 */

import { SYSTEM } from "@/auth/actor";
import { ensurePerm } from "@/auth/permissions";
import {
	MAX_ANSWER_HISTORY_ATTEMPT_BYTES,
	MAX_ANSWER_HISTORY_ATTEMPT_EDITS,
	MAX_ANSWER_HISTORY_BATCH_BYTES,
	MAX_ANSWER_HISTORY_BATCH_EDITS,
	MAX_ANSWER_HISTORY_REQUEST_BYTES,
	MAX_ANSWER_HISTORY_TEXT_BYTES,
} from "@/core/constants";
import { InvalidData, NotAllowed, NotFound } from "@/core/error";
import type {
	AnswerEditFieldId,
	AnswerEditHistoryId,
	CourseRef,
	ExamId,
	QuestionRefId,
	ResponseId,
} from "@/core/schemas";
import {
	type AnswerEditAppendInput,
	type AnswerEditAppendResult,
	type AnswerEditAttemptRef,
	type AnswerEditBatchInput,
	type AnswerEditClosedReason,
	type AnswerEditConflictReason,
	type AnswerEditFieldResult,
	type AnswerEditInspectResult,
	type AnswerEditReceipt,
	type AnswerEditServerField,
	type AnswerEditSummaryRef,
	type AnswerEditSummaryResult,
	answerEditAppendArgs,
	answerEditAppendResult,
	answerEditAttemptArgs,
	answerEditBatchInput,
	answerEditGapInput,
	answerEditInspectResult,
	answerEditItemEnvelope,
	answerEditSummaryArgs,
	answerEditSummaryResult,
	INT32_MAX,
	MAX_ANSWER_EDIT_GAP_REASON,
} from "@/core/schemas/answer-edit";
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import type { EditTuple } from "@/services/answer-edits/codec";
import {
	batchContentHash,
	replayBatch,
} from "@/services/answer-edits/server-batch";
import { summarizeAnswerEdits } from "@/services/answer-edits/summary";
import {
	answerHistoryWindow,
	effectiveAnswerHistory,
	isHistoryField,
} from "@/services/answer-history";
import { attemptDeadline, viewerTiming } from "@/services/exam-state";
import { courseHref } from "@/urls";
import { logEvent } from "@/utils/log";
import type { Prisma, PrismaClient, PrismaTx } from "../client";
import { courseRefMatch } from "../utils";
import {
	assertAcceptingSubmissions,
	examTimingFromDb,
	examTimingSelect,
	loadExceptionTiming,
} from "./submission.service";

export type {
	AnswerEditAppendInput,
	AnswerEditAppendResult,
	AnswerEditAttemptRef,
	AnswerEditBase,
	AnswerEditBatchInput,
	AnswerEditClosedReason,
	AnswerEditConflictReason,
	AnswerEditFieldInput,
	AnswerEditFieldResult,
	AnswerEditInspectResult,
	AnswerEditReceipt,
	AnswerEditServerField,
	AnswerEditSummary,
	AnswerEditSummaryResult,
} from "@/core/schemas/answer-edit";

/// How many receipts of a field `inspect` returns.
const RECEIPTS_PER_FIELD = 32;

/// Most gaps one field keeps.
const MAX_GAPS_PER_FIELD = 50;

/// Reason of the gap left when a batch is refused for its size.
const BATCH_TOO_LARGE = "batch-too-large";

/** The answer-edit history service. */
export const makeAnswerEditService = defineService()(() => {
	/**
	 * Tells a browser where the server's history of each field stands, so it can continue it.
	 *
	 * Only the author of the attempt may ask. Reads without a transaction and
	 * creates nothing.
	 *
	 * @throws {@link NotFound} If the attempt is not the actor's, or does not belong to that exam and course.
	 */
	const inspect = op({
		transaction: false,
		args: [answerEditAttemptArgs],
		returns: answerEditInspectResult,
		run: async (
			tx: PrismaTx,
			input: AnswerEditAttemptRef,
			opts: ServiceOptsWithoutTx,
		): Promise<AnswerEditInspectResult> => {
			const ctx = await loadContext(tx, input, opts);
			const history = await tx.answerEditHistory.findUnique({
				where: { responseId: ctx.responseId },
				select: {
					incompleteAt: true,
					fields: {
						orderBy: { id: "asc" },
						select: {
							id: true,
							field: true,
							text: true,
							revision: true,
							nextSeq: true,
							incompleteAt: true,
							question: { select: { slug: true } },
						},
					},
				},
			});

			const fields: AnswerEditServerField[] = [];
			for (const row of history?.fields ?? []) {
				const batches = await tx.answerEditBatch.findMany({
					where: { fieldId: row.id },
					orderBy: { revision: "desc" },
					take: RECEIPTS_PER_FIELD,
					select: {
						batchId: true,
						revision: true,
						firstSeq: true,
						editCount: true,
					},
				});
				fields.push({
					question: row.question.slug,
					field: row.field,
					text: row.text,
					revision: row.revision,
					nextSeq: row.nextSeq,
					canWrite:
						ctx.enabled &&
						ctx.window.open &&
						!history?.incompleteAt &&
						!row.incompleteAt,
					receipts: batches.reverse().map(receiptOf),
				});
			}
			return { enabled: ctx.enabled, fields };
		},
	});

	/**
	 * Stores the batches and gap markers a browser collected, one result per item.
	 *
	 * Only the author of the attempt may send. A malformed or refused item is
	 * answered on its own and never stops the others; the only throws are for an
	 * attempt that is not the actor's and a request that is not an envelope.
	 *
	 * @throws {@link NotFound} If the attempt is not the actor's, or does not belong to that exam and course.
	 * @throws {@link InvalidData} If the request is not an envelope or carries more than 128 items.
	 */
	const append = op({
		transaction: false,
		args: [answerEditAppendArgs],
		returns: answerEditAppendResult,
		run: async (
			tx: PrismaTx,
			input: AnswerEditAppendInput,
			opts: ServiceOptsWithoutTx,
		): Promise<AnswerEditAppendResult> => {
			const ctx = await loadContext(tx, input, opts);
			const results: AnswerEditFieldResult[] = [];
			let processed = 0;

			for (const raw of input.fields as unknown[]) {
				if (processed > MAX_ANSWER_HISTORY_REQUEST_BYTES) {
					results.push({ ...namesOf(raw), kind: "retry" });
					continue;
				}
				const sized = measure(raw);
				processed += sized.bytes;
				results.push(await appendItem(tx, ctx, raw, sized));
			}
			return { enabled: ctx.enabled, results };
		},
	});

	/**
	 * Summarizes how each followed answer of an attempt was typed, for whoever grades it.
	 *
	 * Reads the batches and gap markers of every followed question at once and
	 * writes nothing. The attempt is the author's first one at the exam, the
	 * same one the instructor's attempt page shows (a practice exam may hold
	 * several). The history is kept when the exam's switch goes off, so it is
	 * read whatever `enabled` says.
	 *
	 * @throws {@link NotFound} If the exam does not exist in the course, or the author has no attempt at it.
	 * @throws {@link NotAllowed} If the actor does not grade the course.
	 */
	const summary = op({
		transaction: false,
		args: [answerEditSummaryArgs],
		returns: answerEditSummaryResult,
		run: async (
			tx: PrismaTx,
			input: AnswerEditSummaryRef,
			opts: ServiceOptsWithoutTx,
		): Promise<AnswerEditSummaryResult> => {
			const exam = await tx.exam.findFirst({
				where: { slug: input.exam, course: courseRefMatch(input.course) },
				select: {
					id: true,
					type: true,
					answerHistory: true,
					course: {
						select: {
							instructor: { select: { username: true } },
							enrollments: { select: { username: true } },
						},
					},
				},
			});
			if (!exam) throw new NotFound("exam");
			ensurePerm(opts.actor, "response.read-edits", {
				author: { username: input.author },
				course: exam.course,
			});

			const attempt = await tx.response.findFirst({
				where: { examId: exam.id, authorId: input.author },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				select: { id: true },
			});
			if (!attempt) throw new NotFound("attempt");

			const [questions, history, submissions] = await Promise.all([
				followedQuestions(tx, exam.id),
				tx.answerEditHistory.findUnique({
					where: { responseId: attempt.id },
					select: {
						incompleteAt: true,
						fields: {
							where: { field: "answer" },
							select: {
								questionId: true,
								text: true,
								incompleteAt: true,
								batches: {
									orderBy: { revision: "asc" },
									select: {
										sessionId: true,
										timeOriginMs: true,
										edits: true,
										receivedAt: true,
										baseReason: true,
										baseText: true,
										gapBefore: true,
									},
								},
								gaps: {
									orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
									select: { reason: true, receivedAt: true },
								},
							},
						},
					},
				}),
				tx.submission.findMany({
					where: { responseId: attempt.id },
					orderBy: [{ createdAt: "asc" }, { id: "asc" }],
					select: { questionId: true, payload: true },
				}),
			]);

			const answers = new Map<number, string | null>();
			for (const submission of submissions) {
				const { payload } = submission;
				answers.set(
					submission.questionId,
					typeof payload === "string" ? payload : null,
				);
			}
			const fields = new Map(
				(history?.fields ?? []).map((row) => [row.questionId, row]),
			);

			return {
				enabled: effectiveAnswerHistory(exam),
				incomplete: Boolean(history?.incompleteAt),
				questions: questions.map(({ id, slug }) => {
					const row = fields.get(id);
					return {
						question: slug,
						summary: summarizeAnswerEdits({
							batches: (row?.batches ?? []).map((batch) => ({
								...batch,
								edits: batch.edits as unknown as EditTuple[],
								baseReason: batch.baseReason as "start" | "rebase" | null,
							})),
							markers: row?.gaps ?? [],
							anchorText: row?.text ?? null,
							answerText: answers.get(id) ?? null,
							incomplete: Boolean(history?.incompleteAt || row?.incompleteAt),
						}),
					};
				}),
			};
		},
	});

	/**
	 * Measures the edit history of a course's exams, one line per exam and a total.
	 *
	 * Reads only, and only for `SYSTEM`. Sizes are the estimate of
	 * {@link measureAnswerHistoryByAttempt}; the median and the maximum are
	 * over the attempts that have a history.
	 *
	 * @throws {@link NotAllowed} If the actor is not `SYSTEM`.
	 * @throws {@link NotFound} If the course, or the exam named, does not exist.
	 */
	const stats = op({
		transaction: false,
		run: async (
			tx: PrismaTx,
			input: AnswerHistoryStatsRef,
			opts: ServiceOptsWithoutTx,
		): Promise<AnswerHistoryReport> => {
			if (opts.actor !== SYSTEM) throw new NotAllowed("response.read-edits");
			const course = await tx.course.findFirst({
				where: courseRefMatch(input.course),
				select: { id: true },
			});
			if (!course) throw new NotFound("course");
			const exams = await tx.exam.findMany({
				where: {
					courseId: course.id,
					...(input.exam === undefined ? {} : { slug: input.exam }),
				},
				orderBy: { slug: "asc" },
				select: { id: true, slug: true },
			});
			if (input.exam !== undefined && exams.length === 0) {
				throw new NotFound("exam");
			}

			const lines: AnswerHistoryExamStats[] = [];
			const every: AnswerHistoryAttemptStats[] = [];
			let attempts = 0;
			for (const exam of exams) {
				const count = await tx.response.count({ where: { examId: exam.id } });
				const rows = await measureAnswerHistoryByAttempt(tx, {
					exam: exam.id,
				});
				lines.push({ exam: exam.slug, ...summarize(count, rows) });
				every.push(...rows);
				attempts += count;
			}
			return { exams: lines, total: summarize(attempts, every) };
		},
	});

	return { inspect, append, summary, stats };
});

// Measuring the history ---------------------------------------------------

/// Which attempts to measure: the given ones, every one of a user, or every one at an exam.
export type AnswerHistoryScope =
	| { responseIds: ResponseId[] }
	| { author: string }
	| { exam: ExamId };

/// What the history of one attempt holds.
export interface AnswerHistoryAttemptStats {
	responseId: ResponseId;
	examId: ExamId;
	fields: number;
	batches: number;
	gaps: number;
	/// `AnswerEditHistory.editCount`.
	edits: number;
	/// `AnswerEditHistory.byteCount`, what the history counts against its limit.
	countedBytes: number;
	/// Bytes of the columns the history stores, summed in the database.
	storedBytes: number;
	/// True when the attempt or one of its fields reached a limit.
	incomplete: boolean;
}

/// The sum of {@link AnswerHistoryAttemptStats} over the attempts of a scope.
export interface AnswerHistoryStats {
	/// Attempts that have a history.
	attempts: number;
	fields: number;
	batches: number;
	gaps: number;
	edits: number;
	countedBytes: number;
	storedBytes: number;
}

/// What `stats` measures.
export interface AnswerHistoryStatsRef {
	course: CourseRef;
	/// An exam slug; every exam of the course when omitted.
	exam?: string;
}

/// The history of one exam.
export interface AnswerHistoryExamStats {
	exam: string;
	/// Every attempt, with or without history.
	attempts: number;
	withHistory: number;
	incomplete: number;
	fields: number;
	batches: number;
	gaps: number;
	edits: number;
	countedBytes: number;
	storedBytes: number;
	/// Over the attempts that have a history, rounded to a byte.
	medianStoredBytes: number;
	maxStoredBytes: number;
}

/// What `stats` answers: a line per exam and the total.
export interface AnswerHistoryReport {
	exams: AnswerHistoryExamStats[];
	total: Omit<AnswerHistoryExamStats, "exam">;
}

/// SQL: the bytes of the text and JSON columns of batch `b`.
const SIZE_OF_BATCH = `LENGTH(CAST(b.edits AS BLOB))
	+ COALESCE(LENGTH(CAST(b.baseText AS BLOB)), 0)
	+ COALESCE(LENGTH(CAST(b.gapBefore AS BLOB)), 0)
	+ LENGTH(CAST(b.contentHash AS BLOB))
	+ LENGTH(CAST(b.batchId AS BLOB))
	+ LENGTH(CAST(b.sessionId AS BLOB))`;

/**
 * Measures, per attempt, the edit history `scope` selects, counting in SQL so no batch is loaded.
 *
 * `storedBytes` is an estimate: the bytes of the text and JSON columns of the
 * batches (`edits`, `baseText`, `gapBefore`, `contentHash`, `batchId`,
 * `sessionId`) plus the text of the anchors. It leaves out numbers, dates,
 * indexes and the free space of database pages. Attempts without a history
 * are not returned.
 */
export async function measureAnswerHistoryByAttempt(
	tx: PrismaTx,
	scope: AnswerHistoryScope,
): Promise<AnswerHistoryAttemptStats[]> {
	let where: string;
	let params: (string | number)[];
	if ("responseIds" in scope) {
		if (scope.responseIds.length === 0) return [];
		where = `h.responseId IN (${scope.responseIds.map(() => "?").join(", ")})`;
		params = scope.responseIds;
	} else if ("author" in scope) {
		where = "r.authorId = ?";
		params = [scope.author];
	} else {
		where = "r.examId = ?";
		params = [scope.exam];
	}

	const rows = await tx.$queryRawUnsafe<Record<string, number | bigint>[]>(
		`SELECT
			h.responseId AS responseId,
			r.examId AS examId,
			h.editCount AS edits,
			h.byteCount AS countedBytes,
			(h.incompleteAt IS NOT NULL OR EXISTS (
				SELECT 1 FROM AnswerEditField f
				WHERE f.historyId = h.id AND f.incompleteAt IS NOT NULL
			)) AS incomplete,
			(SELECT COUNT(*) FROM AnswerEditField f WHERE f.historyId = h.id) AS fields,
			(SELECT COUNT(*) FROM AnswerEditBatch b
				JOIN AnswerEditField f ON f.id = b.fieldId
				WHERE f.historyId = h.id) AS batches,
			(SELECT COUNT(*) FROM AnswerEditGap g
				JOIN AnswerEditField f ON f.id = g.fieldId
				WHERE f.historyId = h.id) AS gaps,
			(SELECT COALESCE(SUM(LENGTH(CAST(f.text AS BLOB))), 0)
				FROM AnswerEditField f WHERE f.historyId = h.id)
			+ (SELECT COALESCE(SUM(${SIZE_OF_BATCH}), 0) FROM AnswerEditBatch b
				JOIN AnswerEditField f ON f.id = b.fieldId
				WHERE f.historyId = h.id) AS storedBytes
		FROM AnswerEditHistory h
		JOIN ResponseRef r ON r.id = h.responseId
		WHERE ${where}
		ORDER BY h.responseId`,
		...params,
	);
	return rows.map((row) => ({
		responseId: Number(row.responseId) as ResponseId,
		examId: Number(row.examId) as ExamId,
		fields: Number(row.fields),
		batches: Number(row.batches),
		gaps: Number(row.gaps),
		edits: Number(row.edits),
		countedBytes: Number(row.countedBytes),
		storedBytes: Number(row.storedBytes),
		incomplete: Number(row.incomplete) !== 0,
	}));
}

/**
 * Measures the edit history `scope` selects, summed over its attempts.
 *
 * An estimate, as in {@link measureAnswerHistoryByAttempt}.
 */
export async function measureAnswerHistory(
	tx: PrismaTx,
	scope: AnswerHistoryScope,
): Promise<AnswerHistoryStats> {
	return totalOf(await measureAnswerHistoryByAttempt(tx, scope));
}

/// Sums attempts into {@link AnswerHistoryStats}.
function totalOf(rows: AnswerHistoryAttemptStats[]): AnswerHistoryStats {
	const sum = (pick: (row: AnswerHistoryAttemptStats) => number) =>
		rows.reduce((acc, row) => acc + pick(row), 0);
	return {
		attempts: rows.length,
		fields: sum((row) => row.fields),
		batches: sum((row) => row.batches),
		gaps: sum((row) => row.gaps),
		edits: sum((row) => row.edits),
		countedBytes: sum((row) => row.countedBytes),
		storedBytes: sum((row) => row.storedBytes),
	};
}

/// The line of an exam: `attempts` in all, `rows` the ones with a history.
function summarize(
	attempts: number,
	rows: AnswerHistoryAttemptStats[],
): Omit<AnswerHistoryExamStats, "exam"> {
	const sizes = rows.map((row) => row.storedBytes).sort((a, b) => a - b);
	const middle = Math.floor(sizes.length / 2);
	let median = sizes[middle] ?? 0;
	if (sizes.length > 0 && sizes.length % 2 === 0) {
		median = Math.round(((sizes[middle - 1] ?? 0) + median) / 2);
	}
	const { attempts: withHistory, ...totals } = totalOf(rows);
	return {
		...totals,
		attempts,
		withHistory,
		incomplete: rows.filter((row) => row.incomplete).length,
		medianStoredBytes: median,
		maxStoredBytes: sizes.at(-1) ?? 0,
	};
}

/**
 * Runs `body` in a transaction, measuring the history it is about to remove,
 * and logs `answer-history.removed` once the transaction has committed.
 *
 * `body` calls `measure` before it deletes. Nothing is logged when the scope
 * held no history. A measurement that fails never stops the removal: the line
 * carries `error` instead of the numbers. When the caller already holds a
 * transaction, `body` runs in it and the line is logged when `body` returns,
 * before that transaction commits.
 */
export async function loggingAnswerHistoryRemoval<R>(
	tx: PrismaTx,
	reason: "response-delete" | "user-delete",
	body: (
		tx: PrismaTx,
		measure: (scope: AnswerHistoryScope, username?: string) => Promise<void>,
	) => Promise<R>,
): Promise<R> {
	const measured: { removal?: Record<string, unknown> | null } = {};
	const run = (inner: PrismaTx) =>
		body(inner, async (scope, username) => {
			measured.removal = await describeRemoval(inner, scope, username);
		});
	// A transaction client has no `$connect`, the client itself does.
	const result =
		"$connect" in tx
			? await (tx as unknown as PrismaClient).$transaction(run)
			: await run(tx);
	if (measured.removal) {
		logEvent("answer-history.removed", { reason, ...measured.removal });
	}
	return result;
}

/// The fields of the removal line: `null` when there is no history, `{ error }` when the measurement failed.
async function describeRemoval(
	tx: PrismaTx,
	scope: AnswerHistoryScope,
	username?: string,
): Promise<Record<string, unknown> | null> {
	const who = username === undefined ? {} : { username };
	try {
		const rows = await measureAnswerHistoryByAttempt(tx, scope);
		if (rows.length === 0) return null;
		const exams = await tx.exam.findMany({
			where: { id: { in: [...new Set(rows.map((row) => row.examId))] } },
			select: {
				slug: true,
				course: {
					select: {
						disciplineSlug: true,
						instructorId: true,
						editionSlug: true,
					},
				},
			},
		});
		const only = exams.length === 1 ? exams[0] : undefined;
		return {
			...who,
			course: only
				? courseHref({
						discipline: only.course.disciplineSlug,
						instructor: only.course.instructorId,
						edition: only.course.editionSlug,
					}).slice(1)
				: null,
			exam: only?.slug ?? null,
			...totalOf(rows),
		};
	} catch (error) {
		return {
			...who,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

// Private utilities -------------------------------------------------------

/// What one call knows about the attempt, read once.
interface Context {
	responseId: ResponseId;
	examId: number;
	enabled: boolean;
	window: ReturnType<typeof answerHistoryWindow>;
	now: Date;
}

/// The result of an item before it gets the names of its field.
type Outcome =
	| { kind: "accepted"; receipt?: AnswerEditReceipt }
	| { kind: "conflict"; reason: AnswerEditConflictReason }
	| { kind: "closed"; reason: AnswerEditClosedReason }
	| { kind: "retry" };

const attemptSelect = {
	id: true,
	examId: true,
	authorId: true,
	acceptingSubmissions: true,
	createdAt: true,
	updatedAt: true,
	exam: { select: { ...examTimingSelect, answerHistory: true } },
} satisfies Prisma.ResponseSelect;

/**
 * Finds the attempt of the actor and reads the switch, the deadline and the
 * write window of the exam at `ref.now`.
 *
 * Identity comes from here, never from the request: the same `NotFound` answers
 * an attempt of somebody else, of another exam or course, and a missing one.
 */
async function loadContext(
	tx: PrismaTx,
	ref: AnswerEditAttemptRef,
	opts: ServiceOptsWithoutTx,
): Promise<Context> {
	const { actor } = opts;
	const row =
		typeof actor === "symbol"
			? null
			: await tx.response.findFirst({
					where: {
						publicId: ref.attempt,
						authorId: actor.username,
						exam: { slug: ref.exam, course: courseRefMatch(ref.course) },
					},
					select: attemptSelect,
				});
	if (!row) throw new NotFound("attempt");

	const now = ref.now ?? new Date();
	const exception = await loadExceptionTiming(tx, row.examId, row.authorId);
	const timing = viewerTiming(examTimingFromDb(row.exam), exception);
	let accepting = true;
	try {
		assertAcceptingSubmissions(row, now, exception);
	} catch (error) {
		if (!(error instanceof InvalidData)) throw error;
		accepting = false;
	}
	return {
		responseId: row.id,
		examId: row.examId,
		enabled: effectiveAnswerHistory(row.exam),
		now,
		window: answerHistoryWindow({
			now,
			accepting,
			deadline: attemptDeadline(timing, row),
			closedAt: row.acceptingSubmissions ? null : row.updatedAt,
		}),
	};
}

/// The names of the field an item points at, empty when it does not say.
function namesOf(raw: unknown): { question: string; field: string } {
	const envelope = answerEditItemEnvelope.safeParse(raw);
	return envelope.success
		? { question: envelope.data.question, field: envelope.data.field }
		: { question: "", field: "" };
}

/// Bytes of an item, in the two ways the limits count it.
interface Sized {
	/// The JSON of the whole item, counted against the call.
	bytes: number;
	/// The JSON of `{ question, field, batch }`, counted against the batch and the attempt.
	batchBytes: number;
}

function measure(raw: unknown): Sized {
	const bytes = jsonBytes(raw);
	const envelope = answerEditItemEnvelope.safeParse(raw);
	if (!envelope.success || envelope.data.batch === undefined) {
		return { bytes, batchBytes: bytes };
	}
	const { question, field, batch } = envelope.data;
	return { bytes, batchBytes: jsonBytes({ question, field, batch }) };
}

function jsonBytes(value: unknown): number {
	try {
		return Buffer.byteLength(JSON.stringify(value) ?? "");
	} catch {
		return 0;
	}
}

function receiptOf(row: {
	batchId: string;
	revision: number;
	firstSeq: number;
	editCount: number;
}): AnswerEditReceipt {
	return {
		batchId: row.batchId,
		revision: row.revision,
		lastSeq: row.firstSeq + row.editCount - 1,
	};
}

/// Processes one item and names the result after its field.
async function appendItem(
	tx: PrismaTx,
	ctx: Context,
	raw: unknown,
	sized: Sized,
): Promise<AnswerEditFieldResult> {
	const envelope = answerEditItemEnvelope.safeParse(raw);
	if (!envelope.success) {
		return { question: "", field: "", kind: "conflict", reason: "invalid" };
	}
	const { question, field, batch, gaps } = envelope.data;
	const outcome = await appendField(tx, ctx, {
		question,
		field,
		rawBatch: batch,
		rawGaps: gaps,
		batchBytes: sized.batchBytes,
	});
	return { question, field, ...outcome } as AnswerEditFieldResult;
}

interface FieldItem {
	question: string;
	field: string;
	rawBatch: unknown;
	rawGaps: unknown;
	batchBytes: number;
}

/// The type of the version of a question that an exam row pins, or of its latest one.
async function questionTypeOf(
	tx: PrismaTx,
	row: {
		version: string | null;
		questionRef: { id: QuestionRefId; latestId: number | null };
	},
): Promise<string | undefined> {
	const { id, latestId } = row.questionRef;
	const version = await tx.questionData.findFirst({
		where: row.version
			? { refId: id, versionHash: row.version }
			: { id: latestId ?? -1 },
		select: { publicPayload: true },
	});
	const payload = version?.publicPayload as { type?: unknown } | null;
	return typeof payload?.type === "string" ? payload.type : undefined;
}

/// The ref id of the question `slug` when the exam carries it and its `field` has a history, otherwise `null`.
async function trackedQuestion(
	tx: PrismaTx,
	examId: number,
	slug: string,
	field: string,
): Promise<QuestionRefId | null> {
	const row = await tx.questionsForExam.findFirst({
		where: { examId, questionRef: { slug } },
		select: {
			version: true,
			questionRef: { select: { id: true, latestId: true } },
		},
	});
	if (!row) return null;
	const type = await questionTypeOf(tx, row);
	return isHistoryField(type, field) ? row.questionRef.id : null;
}

/// The questions of an exam whose answer field has a history, in the order of the exam.
async function followedQuestions(
	tx: PrismaTx,
	examId: number,
): Promise<{ id: QuestionRefId; slug: string }[]> {
	const rows = await tx.questionsForExam.findMany({
		where: { examId },
		orderBy: { position: "asc" },
		select: {
			version: true,
			questionRef: { select: { id: true, latestId: true, slug: true } },
		},
	});
	const followed: { id: QuestionRefId; slug: string }[] = [];
	for (const row of rows) {
		if (isHistoryField(await questionTypeOf(tx, row), "answer")) {
			followed.push({ id: row.questionRef.id, slug: row.questionRef.slug });
		}
	}
	return followed;
}

async function appendField(
	tx: PrismaTx,
	ctx: Context,
	item: FieldItem,
): Promise<Outcome> {
	const questionId = await trackedQuestion(
		tx,
		ctx.examId,
		item.question,
		item.field,
	);
	if (questionId === null) return { kind: "closed", reason: "not-tracked" };

	const history = await tx.answerEditHistory.findUnique({
		where: { responseId: ctx.responseId },
		select: { id: true, incompleteAt: true },
	});
	const anchor = history
		? await tx.answerEditField.findUnique({
				where: {
					historyId_questionId_field: {
						historyId: history.id,
						questionId,
						field: item.field,
					},
				},
			})
		: null;

	const parsed =
		item.rawBatch === undefined
			? undefined
			: answerEditBatchInput.safeParse(item.rawBatch);
	const batch = parsed?.success ? (parsed.data as AnswerEditBatchInput) : null;

	let hash: string | undefined;
	let reusedId = false;
	if (batch && anchor) {
		hash = batchContentHash(batch);
		const stored = await tx.answerEditBatch.findUnique({
			where: {
				fieldId_batchId: { fieldId: anchor.id, batchId: batch.batchId },
			},
			select: {
				contentHash: true,
				batchId: true,
				revision: true,
				firstSeq: true,
				editCount: true,
			},
		});
		if (stored) {
			if (stored.contentHash === hash) {
				return { kind: "accepted", receipt: receiptOf(stored) };
			}
			reusedId = true;
		}
	}

	if (!ctx.enabled) return { kind: "closed", reason: "disabled" };
	if (!ctx.window.open) return { kind: "closed", reason: ctx.window.reason };
	if (history?.incompleteAt || anchor?.incompleteAt) {
		return { kind: "closed", reason: "limit" };
	}

	const gaps = parseGaps(item.rawGaps);
	if ((parsed && !parsed.success) || gaps === null) {
		return { kind: "conflict", reason: "invalid" };
	}
	if (reusedId) return { kind: "conflict", reason: "reused-id" };

	const target = { responseId: ctx.responseId, questionId, field: item.field };
	if (!batch) {
		if (gaps.length > 0) {
			await commit(tx, ctx, target, {
				seen: { revision: 0, nextSeq: 0 },
				gaps,
				fallback: { kind: "accepted" },
			});
		}
		return { kind: "accepted" };
	}

	const seen = {
		revision: anchor?.revision ?? 0,
		nextSeq: anchor?.nextSeq ?? 0,
	};
	const verdict = checkBatch(anchor?.text ?? "", seen, batch, item.batchBytes);
	switch (verdict.kind) {
		case "conflict":
			return commitIfAny(tx, ctx, target, gaps, verdict);
		case "too-large":
			return commitIfAny(
				tx,
				ctx,
				target,
				[{ reason: BATCH_TOO_LARGE }, ...gaps],
				{
					kind: "conflict",
					reason: "too-large",
				},
			);
		case "text-limit":
			return commit(tx, ctx, target, {
				seen,
				gaps: [],
				markFieldIncomplete: true,
				fallback: { kind: "closed", reason: "limit" },
			});
		case "ok":
			return commit(tx, ctx, target, {
				seen,
				gaps,
				batch: {
					input: batch,
					hash: hash ?? batchContentHash(batch),
					bytes: item.batchBytes,
				},
				fallback: { kind: "accepted" },
			});
	}
}

/// A gap marker as received: its reason and the optional id the browser gave it.
interface GapMarker {
	reason: string;
	id?: string;
}

/// Drops repeated ids within one item, which the unique index would refuse.
function dedupe(gaps: GapMarker[]): GapMarker[] {
	const seen = new Set<string>();
	return gaps.filter((gap) => {
		if (!gap.id) return true;
		if (seen.has(gap.id)) return false;
		seen.add(gap.id);
		return true;
	});
}

/// Reads the gap markers of an item, or `null` when they are malformed.
function parseGaps(raw: unknown): GapMarker[] | null {
	if (raw === undefined) return [];
	if (!Array.isArray(raw)) return null;
	const markers: GapMarker[] = [];
	for (const gap of raw) {
		const parsed = answerEditGapInput.safeParse(gap);
		if (!parsed.success) return null;
		markers.push({
			reason: parsed.data.reason.slice(0, MAX_ANSWER_EDIT_GAP_REASON),
			id: parsed.data.id,
		});
	}
	return markers;
}

type Verdict =
	| { kind: "ok" }
	| { kind: "text-limit" }
	| { kind: "too-large" }
	| { kind: "conflict"; reason: AnswerEditConflictReason };

/**
 * Judges a batch against the anchor it was sent for, without touching the
 * database: revision and sequence, base, number ranges, size and replay.
 *
 * The sizes come before the replay so that a huge batch is never replayed.
 */
function checkBatch(
	anchorText: string,
	seen: { revision: number; nextSeq: number },
	batch: AnswerEditBatchInput,
	batchBytes: number,
): Verdict {
	if (batch.baseRevision !== seen.revision || batch.firstSeq !== seen.nextSeq) {
		return { kind: "conflict", reason: "base" };
	}
	const hasBase =
		batch.baseRevision === 0
			? batch.base !== undefined
			: batch.base === undefined || batch.base.reason === "rebase";
	if (!hasBase) return { kind: "conflict", reason: "invalid" };

	if (
		batch.baseRevision + 1 > INT32_MAX ||
		batch.firstSeq + batch.edits.length > INT32_MAX
	) {
		return { kind: "conflict", reason: "invalid" };
	}

	if (
		Buffer.byteLength(batch.snapshot) > MAX_ANSWER_HISTORY_TEXT_BYTES ||
		(batch.base &&
			Buffer.byteLength(batch.base.text) > MAX_ANSWER_HISTORY_TEXT_BYTES)
	) {
		return { kind: "text-limit" };
	}
	if (
		batch.edits.length > MAX_ANSWER_HISTORY_BATCH_EDITS ||
		batchBytes > MAX_ANSWER_HISTORY_BATCH_BYTES
	) {
		return { kind: "too-large" };
	}

	const replay = replayBatch(batch.base?.text ?? anchorText, batch);
	if (!replay.ok) return { kind: "conflict", reason: replay.reason };
	if (replay.text !== batch.snapshot) {
		return { kind: "conflict", reason: "replay" };
	}
	return { kind: "ok" };
}

interface Target {
	responseId: ResponseId;
	questionId: QuestionRefId;
	field: string;
}

/// Stores `gaps` and answers `outcome`, or just answers it when there are none.
async function commitIfAny(
	tx: PrismaTx,
	ctx: Context,
	target: Target,
	gaps: GapMarker[],
	outcome: Outcome,
): Promise<Outcome> {
	if (gaps.length === 0) return outcome;
	return commit(tx, ctx, target, {
		seen: { revision: 0, nextSeq: 0 },
		gaps,
		fallback: outcome,
	});
}

interface Commit {
	/// The revision and sequence the batch was validated against.
	seen: { revision: number; nextSeq: number };
	batch?: { input: AnswerEditBatchInput; hash: string; bytes: number };
	gaps: GapMarker[];
	markFieldIncomplete?: boolean;
	/// The answer when no batch is stored and nothing closed the item.
	fallback: Outcome;
}

/**
 * The write: one short transaction that compares the revision the batch was
 * validated against with the anchor, inserts and counts. A unique violation,
 * which only a concurrent writer can cause, is a `base` conflict.
 */
async function commit(
	tx: PrismaTx,
	ctx: Context,
	target: Target,
	work: Commit,
): Promise<Outcome> {
	try {
		return await inWriteTransaction(tx, (wtx) => write(wtx, ctx, target, work));
	} catch (error) {
		if (isUniqueViolation(error)) return { kind: "conflict", reason: "base" };
		throw error;
	}
}

/// Runs `fn` in a transaction, or on `tx` when the caller already holds one.
function inWriteTransaction<R>(
	tx: PrismaTx,
	fn: (tx: PrismaTx) => Promise<R>,
): Promise<R> {
	if ("$transaction" in tx) {
		return (tx as unknown as PrismaClient).$transaction(fn);
	}
	return fn(tx);
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		error.code === "P2002"
	);
}

async function write(
	tx: PrismaTx,
	ctx: Context,
	target: Target,
	work: Commit,
): Promise<Outcome> {
	const history =
		(await tx.answerEditHistory.findUnique({
			where: { responseId: target.responseId },
		})) ??
		(await tx.answerEditHistory.create({
			data: { responseId: target.responseId },
		}));
	const key = {
		historyId: history.id,
		questionId: target.questionId,
		field: target.field,
	};
	const field =
		(await tx.answerEditField.findUnique({
			where: { historyId_questionId_field: key },
		})) ?? (await tx.answerEditField.create({ data: { ...key, text: "" } }));

	if (history.incompleteAt || field.incompleteAt) {
		return { kind: "closed", reason: "limit" };
	}
	if (work.markFieldIncomplete) {
		await tx.answerEditField.update({
			where: { id: field.id },
			data: { incompleteAt: ctx.now },
		});
		return work.fallback;
	}

	let outcome = work.fallback;
	const { batch } = work;
	if (batch) {
		const stored = await tx.answerEditBatch.findUnique({
			where: {
				fieldId_batchId: { fieldId: field.id, batchId: batch.input.batchId },
			},
		});
		if (stored) {
			return stored.contentHash === batch.hash
				? { kind: "accepted", receipt: receiptOf(stored) }
				: { kind: "conflict", reason: "reused-id" };
		}

		if (
			field.revision !== work.seen.revision ||
			field.nextSeq !== work.seen.nextSeq
		) {
			outcome = { kind: "conflict", reason: "base" };
		} else if (
			history.editCount + batch.input.edits.length >
				MAX_ANSWER_HISTORY_ATTEMPT_EDITS ||
			history.byteCount + batch.bytes > MAX_ANSWER_HISTORY_ATTEMPT_BYTES
		) {
			await tx.answerEditHistory.update({
				where: { id: history.id },
				data: { incompleteAt: ctx.now },
			});
			return { kind: "closed", reason: "limit" };
		} else {
			outcome = await insertBatch(tx, ctx, history.id, field, batch);
		}
	}

	if (work.gaps.length > 0) {
		const ids = work.gaps.flatMap((gap) => (gap.id ? [gap.id] : []));
		const known = new Set(
			ids.length === 0
				? []
				: (
						await tx.answerEditGap.findMany({
							where: { fieldId: field.id, clientId: { in: ids } },
							select: { clientId: true },
						})
					).map((gap) => gap.clientId),
		);
		const fresh = work.gaps.filter((gap) => !gap.id || !known.has(gap.id));
		const kept = await tx.answerEditGap.count({ where: { fieldId: field.id } });
		const room = Math.max(0, MAX_GAPS_PER_FIELD - kept);
		if (room > 0) {
			await tx.answerEditGap.createMany({
				data: dedupe(fresh)
					.slice(0, room)
					.map((gap) => ({
						fieldId: field.id,
						reason: gap.reason,
						clientId: gap.id ?? null,
						receivedAt: ctx.now,
					})),
			});
		}
	}
	return outcome;
}

async function insertBatch(
	tx: PrismaTx,
	ctx: Context,
	historyId: AnswerEditHistoryId,
	field: {
		id: AnswerEditFieldId;
		text: string;
		revision: number;
		nextSeq: number;
	},
	batch: NonNullable<Commit["batch"]>,
): Promise<Outcome> {
	const { input } = batch;
	const count = input.edits.length;
	const lost =
		input.base?.reason === "rebase" && input.base.text !== field.text
			? field.text
			: null;

	await tx.answerEditBatch.create({
		data: {
			fieldId: field.id,
			batchId: input.batchId,
			revision: input.baseRevision + 1,
			firstSeq: input.firstSeq,
			editCount: count,
			sessionId: input.sessionId,
			timeOriginMs: input.timeOriginMs,
			version: input.version,
			edits: input.edits as unknown as Prisma.InputJsonValue,
			contentHash: batch.hash,
			byteCount: batch.bytes,
			baseReason: input.base?.reason ?? null,
			baseText: input.base?.text ?? null,
			gapBefore: lost,
			lateMs: ctx.window.open ? ctx.window.lateMs : null,
			receivedAt: ctx.now,
		},
	});
	await tx.answerEditField.update({
		where: { id: field.id },
		data: {
			text: input.snapshot,
			revision: input.baseRevision + 1,
			nextSeq: input.firstSeq + count,
		},
	});
	await tx.answerEditHistory.update({
		where: { id: historyId },
		data: {
			editCount: { increment: count },
			byteCount: { increment: batch.bytes },
		},
	});
	return {
		kind: "accepted",
		receipt: {
			batchId: input.batchId,
			revision: input.baseRevision + 1,
			lastSeq: input.firstSeq + count - 1,
		},
	};
}
