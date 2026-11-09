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
	previousCadenceMs: time.nullable(),
	observations: z.array(z.strictObject({ id, atMs: time, kind })),
	consumedInputs: z.array(id),
	edits: z.array(edit),
	openEdit: z.strictObject({ edit, lastAtMs: time }).nullable(),
});
const checkpoint = z.strictObject({
	version: z.literal(1),
	state: z.strictObject({
		initialRevision: integer,
		initialSeq: integer,
		baseRevision: integer,
		firstSeq: integer,
		pauseMs: time,
		confirmedText: z.string(),
		text: z.string(),
		sessions: z.array(id).min(1),
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
	check(
		new Set(state.sessions).size === state.sessions.length,
		"duplicate sessions",
	);
	check(
		state.sessions.at(-1) === state.active.sessionId,
		"active session must be newest",
	);
	let revision = state.initialRevision;
	let sequence = state.initialSeq;
	const ids = new Set<string>();
	let sessionIndex = -1;
	for (const receipt of state.receipts) {
		const index = state.sessions.findIndex(
			(session) => receipt.batchId === `${session}:${sequence}`,
		);
		check(
			index >= sessionIndex && index >= 0,
			"receipt session order or batch id",
		);
		check(!ids.has(receipt.batchId), "duplicate receipts");
		check(receipt.revision === revision + 1, "receipt revision gap");
		check(receipt.lastSeq >= sequence, "receipt sequence regression");
		revision = receipt.revision;
		sequence = receipt.lastSeq + 1;
		check(Number.isSafeInteger(sequence), "receipt sequence overflow");
		ids.add(receipt.batchId);
		sessionIndex = index;
	}
	check(
		revision === state.baseRevision && sequence === state.firstSeq,
		"confirmed counters",
	);
	if (state.inFlight) {
		const batch = state.inFlight;
		check(
			batch.baseRevision === revision && batch.firstSeq === sequence,
			"in-flight counters",
		);
		check(
			batch.batchId === `${batch.sessionId}:${sequence}`,
			"in-flight batch id",
		);
		check(!ids.has(batch.batchId), "in-flight batch already acknowledged");
		check(
			Number.isSafeInteger(revision + 1) &&
				Number.isSafeInteger(sequence + batch.edits.length),
			"in-flight counter overflow",
		);
	}
}

function validateActive(state: CheckpointState): void {
	const active = state.active;
	check(active.lastAtMs >= active.timeOriginMs, "active clock before origin");
	const observations = new Map(
		active.observations.map((input) => [input.id, input]),
	);
	check(
		observations.size === active.observations.length,
		"duplicate input observations",
	);
	let previous = active.timeOriginMs;
	for (const input of active.observations) {
		check(
			input.atMs >= previous && input.atMs <= active.lastAtMs,
			"input clock order",
		);
		previous = input.atMs;
	}
	check(
		new Set(active.consumedInputs).size === active.consumedInputs.length,
		"duplicate consumed inputs",
	);
	for (const inputId of active.consumedInputs)
		check(observations.has(inputId), "unknown consumed input");
	if (active.previousCadenceMs !== null) {
		check(
			active.consumedInputs.some((inputId) => {
				const input = observations.get(inputId);
				return (
					input?.atMs === active.previousCadenceMs &&
					(input.kind === "typing" || input.kind === "delete")
				);
			}),
			"cadence must identify a consumed input",
		);
	}
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
	const lastReceipt = state.receipts.at(-1);
	let sessionIndex = lastReceipt
		? state.sessions.indexOf(
				lastReceipt.batchId.slice(0, lastReceipt.batchId.lastIndexOf(":")),
			)
		: -1;
	const origins = new Map<string, number>();
	const lastStarts = new Map<string, number>();
	const visit = (
		sessionId: string,
		origin: number,
		edits: readonly { startMs: number; durationMs: number }[],
	): void => {
		const index = state.sessions.indexOf(sessionId);
		check(index >= 0 && index >= sessionIndex, "pending session order");
		sessionIndex = index;
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
