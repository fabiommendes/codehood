import { z } from "zod";
import { encodeEdits, replayEdits } from "./codec";

const time = z.number().finite().nonnegative();
const integer = time.refine(Number.isSafeInteger, "Expected a safe integer");
const id = z.string().min(1);
const kind = z.enum([
	"typing",
	"paste",
	"delete",
	"undo",
	"redo",
	"composition",
	"other",
]);
const timing = z.tuple([integer.positive(), time, time]).nullable();
const edit = z.strictObject({
	position: integer,
	deleteCount: integer,
	insertedText: z.string(),
	startMs: time,
	durationMs: time,
	kind,
	timing,
});
const tuple = z.tuple([
	time,
	time,
	integer,
	integer,
	z.string(),
	integer.max(6),
	timing,
]);
const batch = z.strictObject({
	version: z.literal(1),
	batchId: id,
	sessionId: id,
	timeOriginMs: time,
	baseRevision: integer,
	firstSeq: integer,
	edits: z.array(tuple).min(1),
	snapshot: z.string(),
});
const segment = z.strictObject({
	sessionId: id,
	timeOriginMs: time,
	edits: z.array(edit).min(1),
	snapshot: z.string(),
});
const receipt = z.strictObject({
	batchId: id,
	revision: integer,
	lastSeq: integer,
});
const active = z.strictObject({
	sessionId: id,
	timeOriginMs: time,
	lastAtMs: time,
	edits: z.array(edit),
	openEdit: z.strictObject({ edit, lastAtMs: time }).nullable(),
});
const checkpoint = z.strictObject({
	version: z.literal(2),
	state: z.strictObject({
		baseRevision: integer,
		firstSeq: integer,
		pauseMs: time,
		confirmedText: z.string(),
		text: z.string(),
		receipts: z.array(receipt),
		inFlight: batch.nullable(),
		queue: z.array(segment),
		active,
	}),
});

export type CheckpointState = z.infer<typeof checkpoint>["state"];
export type PendingSegment = z.infer<typeof segment>;

/// Parse a detached checkpoint and verify counters, session boundaries and exact replay.
export function parseCheckpoint(value: unknown): CheckpointState {
	const parsed = checkpoint.safeParse(value);
	if (!parsed.success)
		throw new TypeError("Invalid monitor checkpoint", { cause: parsed.error });
	const state = parsed.data.state;
	validateReceipts(state);
	validateActive(state);
	validateReplay(state);
	return state;
}

/// Session that produced a batch, read from its `<session>:<firstSeq>` identifier.
export function receiptSessionId(batchId: string): string {
	return batchId.slice(0, batchId.lastIndexOf(":"));
}

/// Copy JSON-compatible state before freezing so exports never freeze live monitor data.
export function frozenCopy<T>(value: T): T {
	const copy: T = structuredClone(value);
	freezeTree(copy);
	return copy;
}

function freezeTree(value: unknown): void {
	if (value === null || typeof value !== "object") return;
	for (const child of Object.values(value)) freezeTree(child);
	Object.freeze(value);
}

function check(condition: boolean, message: string): asserts condition {
	if (!condition) throw new TypeError(`Invalid monitor checkpoint: ${message}`);
}

function validateReceipts(state: CheckpointState): void {
	const ids = new Set<string>();
	let revision = -1;
	let lastSeq = -1;
	for (const receipt of state.receipts) {
		check(!ids.has(receipt.batchId), "duplicate receipts");
		ids.add(receipt.batchId);
		const separator = receipt.batchId.lastIndexOf(":");
		const firstSeq = Number(receipt.batchId.slice(separator + 1));
		check(
			separator > 0 &&
				Number.isSafeInteger(firstSeq) &&
				firstSeq >= 0 &&
				receipt.batchId.slice(separator + 1) === String(firstSeq),
			"receipt batch id",
		);
		check(
			receipt.revision > revision &&
				receipt.revision <= state.baseRevision &&
				receipt.lastSeq >= firstSeq &&
				firstSeq > lastSeq &&
				receipt.lastSeq < state.firstSeq,
			"receipt counters",
		);
		revision = receipt.revision;
		lastSeq = receipt.lastSeq;
	}
	const batch = state.inFlight;
	if (batch) {
		check(
			batch.baseRevision === state.baseRevision &&
				batch.firstSeq === state.firstSeq,
			"in-flight counters",
		);
		check(
			batch.batchId === `${batch.sessionId}:${state.firstSeq}` &&
				!ids.has(batch.batchId),
			"in-flight batch id",
		);
		check(
			Number.isSafeInteger(state.baseRevision + 1) &&
				Number.isSafeInteger(state.firstSeq + batch.edits.length),
			"in-flight counter overflow",
		);
	}
}

function validateActive(state: CheckpointState): void {
	const active = state.active;
	check(active.lastAtMs >= active.timeOriginMs, "active clock before origin");
	const pending = [...active.edits];
	if (active.openEdit) {
		const open = active.openEdit;
		check(
			open.lastAtMs <= active.lastAtMs &&
				open.lastAtMs - open.edit.startMs === open.edit.durationMs,
			"open edit duration",
		);
		pending.push(open.edit);
	}
	for (const edit of pending) {
		check(
			edit.startMs <= active.lastAtMs &&
				edit.durationMs <= active.lastAtMs - edit.startMs,
			"edit exceeds active clock",
		);
	}
}

function validateReplay(state: CheckpointState): void {
	let text = state.confirmedText;
	/// Pending sessions are visited oldest first; a session may repeat only back to back.
	const visited: string[] = [];
	const origins = new Map<string, number>();
	const lastStarts = new Map<string, number>();
	const visit = (
		sessionId: string,
		origin: number,
		edits: readonly { startMs: number; durationMs: number }[],
	): void => {
		const index = visited.indexOf(sessionId);
		check(index < 0 || index === visited.length - 1, "pending session order");
		if (index < 0) visited.push(sessionId);
		const knownOrigin = origins.get(sessionId);
		check(
			knownOrigin === undefined || knownOrigin === origin,
			"session origin mismatch",
		);
		origins.set(sessionId, origin);
		let previous = lastStarts.get(sessionId) ?? origin;
		for (const edit of edits) {
			check(
				edit.startMs >= previous &&
					Number.isFinite(edit.startMs + edit.durationMs),
				"pending edit clock order",
			);
			if (sessionId === state.active.sessionId) {
				check(
					edit.startMs <= state.active.lastAtMs &&
						edit.durationMs <= state.active.lastAtMs - edit.startMs,
					"pending edit exceeds active clock",
				);
			}
			previous = edit.startMs;
		}
		lastStarts.set(sessionId, previous);
	};
	if (state.inFlight) {
		const batch = state.inFlight;
		// Replay also validates the complete tuple envelope.
		text = replayEdits(text, batch);
		check(text === batch.snapshot, "in-flight snapshot differs from replay");
		let startMs = batch.timeOriginMs;
		visit(
			batch.sessionId,
			batch.timeOriginMs,
			batch.edits.map((tuple) => {
				startMs += tuple[0];
				return { startMs, durationMs: tuple[1] };
			}),
		);
	}
	const queuedSessions = new Set<string>();
	for (const segment of state.queue) {
		check(!queuedSessions.has(segment.sessionId), "duplicate queued sessions");
		queuedSessions.add(segment.sessionId);
		visit(segment.sessionId, segment.timeOriginMs, segment.edits);
		check(
			segment.sessionId !== state.active.sessionId,
			"queued active session",
		);
		text = replayEdits(text, encodeEdits(segment.edits, segment.timeOriginMs));
		check(text === segment.snapshot, "queued snapshot differs from replay");
	}
	const active = state.active;
	const pending = active.openEdit
		? [...active.edits, active.openEdit.edit]
		: active.edits;
	visit(active.sessionId, active.timeOriginMs, pending);
	text = replayEdits(text, encodeEdits(pending, active.timeOriginMs));
	check(text === state.text, "document differs from replay");
}
