/**
 * Shapes of the answer-edit history service: what a browser sends, what the
 * server answers, and the checks applied to each item of a request.
 *
 * A request is validated item by item (`answerEditBatchInput`, `answerEditGapInput`),
 * not as a whole, so a malformed item never takes the others down.
 */
import { z } from "zod";
import { type CourseRef, courseRef } from "./course";

/// Largest value an `Int` column holds.
export const INT32_MAX = 2_147_483_647;

/// Most items one append call takes.
export const MAX_ANSWER_EDIT_ITEMS = 128;

/// Longest gap reason, in characters.
export const MAX_ANSWER_EDIT_GAP_REASON = 200;

/// Longest batch or session id, in characters.
const MAX_ID_LENGTH = 200;

/// A counter the database stores in an `Int` column.
const counter = z.number().int().min(0).max(INT32_MAX);

//
// Request
//

export const answerEditBase = z.object({
	reason: z.enum(["start", "rebase"]),
	text: z.string(),
});

/// One batch as the monitor produces it (`PendingEditBatch`).
export const answerEditBatchInput = z.object({
	version: z.literal(1),
	batchId: z.string().min(1).max(MAX_ID_LENGTH),
	sessionId: z.string().min(1).max(MAX_ID_LENGTH),
	timeOriginMs: counter,
	baseRevision: counter,
	firstSeq: counter,
	edits: z.array(z.array(z.unknown())).min(1),
	snapshot: z.string(),
	base: answerEditBase.optional(),
});

export const answerEditGapInput = z.object({
	reason: z.string().max(MAX_ANSWER_EDIT_GAP_REASON),
	/// Opaque id the browser generated for the marker; a stored id is skipped.
	id: z.string().min(1).max(MAX_ID_LENGTH).optional(),
});

/// The envelope of one item; `batch` and `gaps` are checked on their own.
export const answerEditItemEnvelope = z.object({
	question: z.string(),
	field: z.string(),
	batch: z.unknown().optional(),
	gaps: z.unknown().optional(),
});

/**
 * What a client names to reach its attempt: the attempt by `publicId`, the
 * course and the exam. Identity and deadline never come from the client.
 */
export const answerEditAttemptRequest = z.object({
	course: courseRef,
	exam: z.string().min(1).max(200),
	attempt: z.string().min(1).max(64),
});

/**
 * The request of an append call as a client may send it. Items are checked one
 * by one by the service. Unknown keys, the clock override `now` among them,
 * are dropped.
 */
export const answerEditAppendRequest = answerEditAttemptRequest.extend({
	fields: z.array(z.unknown()).max(MAX_ANSWER_EDIT_ITEMS),
});

/// What the service takes: the client request plus the clock override used by tests.
export const answerEditAttemptArgs = answerEditAttemptRequest.extend({
	now: z.date().optional(),
});

export const answerEditAppendArgs = answerEditAppendRequest.extend({
	now: z.date().optional(),
});

//
// Response
//

export const answerEditReceipt = z.object({
	batchId: z.string(),
	revision: z.number().int(),
	lastSeq: z.number().int(),
});

export const answerEditClosedReason = z.enum([
	"deadline",
	"finished",
	"disabled",
	"not-tracked",
	"limit",
]);

export const answerEditConflictReason = z.enum([
	"base",
	"replay",
	"invalid",
	"reused-id",
	"too-large",
]);

const named = { question: z.string(), field: z.string() };

/// The outcome of one item of an append call.
export const answerEditFieldResult = z.discriminatedUnion("kind", [
	z.object({
		...named,
		kind: z.literal("accepted"),
		receipt: answerEditReceipt.optional(),
	}),
	z.object({
		...named,
		kind: z.literal("conflict"),
		reason: answerEditConflictReason,
	}),
	z.object({
		...named,
		kind: z.literal("closed"),
		reason: answerEditClosedReason,
	}),
	z.object({ ...named, kind: z.literal("retry") }),
]);

export const answerEditAppendResult = z.object({
	enabled: z.boolean(),
	results: z.array(answerEditFieldResult),
});

export const answerEditServerField = z.object({
	question: z.string(),
	field: z.string(),
	text: z.string(),
	revision: z.number().int(),
	nextSeq: z.number().int(),
	canWrite: z.boolean(),
	receipts: z.array(answerEditReceipt),
});

export const answerEditInspectResult = z.object({
	enabled: z.boolean(),
	fields: z.array(answerEditServerField),
});

/// What the instructor reads about how one answer was typed.
export const answerEditSummary = z.object({
	state: z.enum(["complete", "incomplete", "none"]),
	/// Time spent typing, in milliseconds.
	activeMs: z.number().int().min(0),
	firstAt: z.date().nullable(),
	lastAt: z.date().nullable(),
	/// Edits per input kind.
	kinds: z.object({
		typing: z.number().int(),
		paste: z.number().int(),
		delete: z.number().int(),
		undo: z.number().int(),
		redo: z.number().int(),
		composition: z.number().int(),
		other: z.number().int(),
	}),
	pastes: z.object({ count: z.number().int(), chars: z.number().int() }),
	largeInsertions: z.array(
		z.object({
			kind: z.enum([
				"typing",
				"paste",
				"delete",
				"undo",
				"redo",
				"composition",
				"other",
			]),
			length: z.number().int(),
			receivedAt: z.date(),
		}),
	),
	gaps: z.array(
		z.discriminatedUnion("type", [
			z.object({
				type: z.literal("marker"),
				reason: z.string(),
				receivedAt: z.date(),
			}),
			z.object({
				type: z.literal("rebase"),
				removed: z.number().int(),
				inserted: z.number().int(),
				receivedAt: z.date(),
			}),
			z.object({
				type: z.literal("final"),
				removed: z.number().int(),
				inserted: z.number().int(),
			}),
		]),
	),
});

export const answerEditSummaryResult = z.object({
	/// The exam's effective switch: whether the browsers still record.
	enabled: z.boolean(),
	/// A limit of the whole attempt was reached.
	incomplete: z.boolean(),
	questions: z.array(
		z.object({ question: z.string(), summary: answerEditSummary }),
	),
});

//
// Types
//

export interface AnswerEditBase {
	reason: "start" | "rebase";
	text: string;
}

/// One batch as the monitor produces it (`PendingEditBatch`).
export interface AnswerEditBatchInput {
	version: 1;
	batchId: string;
	sessionId: string;
	timeOriginMs: number;
	baseRevision: number;
	firstSeq: number;
	edits: readonly (readonly unknown[])[];
	snapshot: string;
	base?: AnswerEditBase;
}

export interface AnswerEditFieldInput {
	question: string;
	field: string;
	batch?: AnswerEditBatchInput;
	gaps?: { reason: string; id?: string }[];
}

export type AnswerEditReceipt = z.infer<typeof answerEditReceipt>;
export type AnswerEditClosedReason = z.infer<typeof answerEditClosedReason>;
export type AnswerEditConflictReason = z.infer<typeof answerEditConflictReason>;
export type AnswerEditFieldResult = z.infer<typeof answerEditFieldResult>;
export type AnswerEditAppendResult = z.infer<typeof answerEditAppendResult>;
export type AnswerEditServerField = z.infer<typeof answerEditServerField>;
export type AnswerEditInspectResult = z.infer<typeof answerEditInspectResult>;

export type AnswerEditSummary = z.infer<typeof answerEditSummary>;
export type AnswerEditSummaryResult = z.infer<typeof answerEditSummaryResult>;

/// The attempt whose history an instructor reads: the author's, in the course's exam.
export const answerEditSummaryArgs = z.object({
	course: courseRef,
	exam: z.string().min(1).max(200),
	author: z.string().min(1),
});

export type AnswerEditSummaryRef = z.infer<typeof answerEditSummaryArgs>;

export interface AnswerEditAttemptRef {
	course: CourseRef;
	exam: string;
	/// `Response.publicId`
	attempt: string;
	/// Overrides the clock of the deadline rules; the Actions never forward it.
	now?: Date;
}

export interface AnswerEditAppendInput extends AnswerEditAttemptRef {
	fields: AnswerEditFieldInput[];
}
