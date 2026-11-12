/**
 * STUB. The edit history of open answers (spec
 * `dev/specs/to-do/historico-de-edicao-no-servidor.md`, R4 to R20): the
 * operations exist so the specs compile, and every one throws until the
 * service is written.
 */
import type { ServiceOptsWithoutTx } from "@/db/base-service";
import { defineService, op } from "@/db/define-service";
import type { PrismaTx } from "../client";

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
	gaps?: { reason: string }[];
}

export interface AnswerEditReceipt {
	batchId: string;
	revision: number;
	lastSeq: number;
}

export type AnswerEditClosedReason =
	| "deadline"
	| "finished"
	| "disabled"
	| "not-tracked"
	| "limit";

export type AnswerEditConflictReason =
	| "base"
	| "replay"
	| "invalid"
	| "reused-id"
	| "too-large";

/// The outcome of one item of an append call.
export type AnswerEditFieldResult = { question: string; field: string } & (
	| { kind: "accepted"; receipt?: AnswerEditReceipt }
	| { kind: "conflict"; reason: AnswerEditConflictReason }
	| { kind: "closed"; reason: AnswerEditClosedReason }
	| { kind: "retry" }
);

export interface AnswerEditAttemptRef {
	course: number;
	exam: string;
	/// `Response.publicId`
	attempt: string;
	/// Overrides the clock of the deadline rules; the Actions never forward it.
	now?: Date;
}

export interface AnswerEditAppendInput extends AnswerEditAttemptRef {
	fields: AnswerEditFieldInput[];
}

export interface AnswerEditAppendResult {
	enabled: boolean;
	results: AnswerEditFieldResult[];
}

export interface AnswerEditServerField {
	question: string;
	field: string;
	text: string;
	revision: number;
	nextSeq: number;
	canWrite: boolean;
	receipts: AnswerEditReceipt[];
}

export interface AnswerEditInspectResult {
	enabled: boolean;
	fields: AnswerEditServerField[];
}

/** The answer-edit history service. */
export const makeAnswerEditService = defineService()(() => {
	const inspect = op({
		run: async (
			_tx: PrismaTx,
			_input: AnswerEditAttemptRef,
			_opts: ServiceOptsWithoutTx,
		): Promise<AnswerEditInspectResult> => {
			throw new Error("AnswerEditService.inspect is not implemented");
		},
	});

	const append = op({
		run: async (
			_tx: PrismaTx,
			_input: AnswerEditAppendInput,
			_opts: ServiceOptsWithoutTx,
		): Promise<AnswerEditAppendResult> => {
			throw new Error("AnswerEditService.append is not implemented");
		},
	});

	return { inspect, append };
});
