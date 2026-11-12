/**
 * Checks the server runs on a received edit batch: its content hash and its replay.
 */
import { createHash } from "node:crypto";
import type { AnswerEditBatchInput } from "@/core/schemas/answer-edit";
import { decodeEdits, replayEdits } from "./codec";

/**
 * The sha-256 of the canonical JSON of `batch`, which tells a retry from a reused batch id.
 *
 * The keys are in a fixed order and unknown keys are left out, so the request's
 * key order does not matter.
 */
export function batchContentHash(batch: AnswerEditBatchInput): string {
	const canonical = JSON.stringify({
		version: batch.version,
		batchId: batch.batchId,
		sessionId: batch.sessionId,
		timeOriginMs: batch.timeOriginMs,
		baseRevision: batch.baseRevision,
		firstSeq: batch.firstSeq,
		edits: batch.edits,
		snapshot: batch.snapshot,
		base: batch.base
			? { reason: batch.base.reason, text: batch.base.text }
			: null,
	});
	return createHash("sha256").update(canonical).digest("hex");
}

/// The text a batch produces, or why it cannot be replayed: `invalid` for edits the codec refuses, `replay` for edits that do not fit the text.
export type BatchReplay =
	| { ok: true; text: string }
	| { ok: false; reason: "invalid" | "replay" };

/**
 * Replays the edits of `batch` on `start`.
 *
 * @example
 * replayBatch("", batch); // { ok: true, text: batch.snapshot }
 */
export function replayBatch(
	start: string,
	batch: Pick<AnswerEditBatchInput, "timeOriginMs" | "edits">,
): BatchReplay {
	const envelope = {
		version: 1,
		timeOriginMs: batch.timeOriginMs,
		edits: batch.edits,
	};
	try {
		decodeEdits(envelope);
	} catch (error) {
		if (error instanceof TypeError) return { ok: false, reason: "invalid" };
		throw error;
	}
	try {
		return { ok: true, text: replayEdits(start, envelope) };
	} catch (error) {
		if (error instanceof TypeError) return { ok: false, reason: "replay" };
		throw error;
	}
}
