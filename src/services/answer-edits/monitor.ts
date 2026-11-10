import {
	type CheckpointState,
	frozenCopy,
	type PendingSegment,
	parseCheckpoint,
	receiptSessionId,
} from "./checkpoint";
import {
	type AnswerEdit,
	applyReplacements,
	type EditTiming,
	type EditTuple,
	encodeEdits,
	type InputKind,
	type TextReplacement,
} from "./codec";

export interface MonitorOptions {
	readonly initialText: string;
	readonly sessionId: string;
	readonly baseRevision: number;
	readonly firstSeq: number;
	readonly pauseMs?: number;
	readonly now: () => number;
}
/// Opaque handle issued by `observeInput`; valid only in the session that issued it.
export type InputToken = string;
export interface InputObservation {
	readonly atMs: number;
	readonly kind: InputKind;
}
export interface DocumentChange {
	readonly atMs: number;
	readonly input?: InputToken;
	readonly kind: InputKind;
	readonly replacements: readonly TextReplacement[];
}
export interface PendingEditBatch {
	readonly version: 1;
	readonly batchId: string;
	readonly sessionId: string;
	readonly timeOriginMs: number;
	readonly baseRevision: number;
	readonly firstSeq: number;
	readonly edits: readonly EditTuple[];
	readonly snapshot: string;
}
export interface BatchReceipt {
	readonly batchId: string;
	readonly revision: number;
	readonly lastSeq: number;
}
export interface MonitorState {
	readonly text: string;
	readonly hasPendingChanges: boolean;
	readonly hasUnacknowledgedBatch: boolean;
}
export interface MonitorCheckpoint {
	readonly version: 2;
	readonly state: unknown;
}
export interface MonitorHandle {
	getState(): Readonly<MonitorState>;
	collect(): Readonly<PendingEditBatch> | null;
	acknowledge(receipt: BatchReceipt): void;
	exportCheckpoint(): Readonly<MonitorCheckpoint>;
}

interface OpenEdit {
	edit: AnswerEdit;
	lastAtMs: number;
}

const DEFAULT_PAUSE_MS = 1000;
/// Acknowledged batches remembered so a repeated receipt is recognised as a retry.
const MAX_RECEIPTS = 32;
/// Unconsumed observations kept; the oldest is dropped when a new one overflows.
const MAX_OBSERVATIONS = 16;
const INPUT_KINDS: readonly InputKind[] = [
	"typing",
	"paste",
	"delete",
	"undo",
	"redo",
	"composition",
	"other",
];

/**
 * Capture canonical document changes independently of editors and persistence.
 */
export class AnswerEditMonitor implements MonitorHandle {
	private readonly sessionId: string;
	private baseRevision: number;
	private firstSeq: number;
	private readonly timeOriginMs: number;
	private readonly pauseMs: number;
	private text: string;
	private confirmedText: string;
	private queue: PendingSegment[] = [];
	private lastAtMs: number;
	private nextInput = 0;
	private readonly observations = new Map<InputToken, InputObservation>();
	private previousCadenceMs: number | null = null;
	private openEdit: OpenEdit | null = null;
	private edits: AnswerEdit[] = [];
	private inFlight: Readonly<PendingEditBatch> | null = null;
	private readonly receipts = new Map<
		string,
		Readonly<CheckpointState["receipts"][number]>
	>();
	private readonly listeners = new Set<
		(state: Readonly<MonitorState>) => void
	>();
	private disposed = false;

	/**
	 * Start a session using the supplied clock's current time as its origin.
	 *
	 * @throws {TypeError} If options or the clock origin are invalid.
	 */
	constructor(options: MonitorOptions) {
		requireRecord(options, "options");
		if (typeof options.initialText !== "string")
			throw new TypeError("initialText must be a string");
		requireId(options.sessionId, "sessionId");
		requireInteger(options.baseRevision, "baseRevision");
		requireInteger(options.firstSeq, "firstSeq");
		const pauseMs =
			options.pauseMs === undefined ? DEFAULT_PAUSE_MS : options.pauseMs;
		requireTime(pauseMs, "pauseMs");
		if (typeof options.now !== "function")
			throw new TypeError("now must be a function");
		const origin = wholeMs(options.now(), "timeOriginMs");
		this.sessionId = options.sessionId;
		this.baseRevision = options.baseRevision;
		this.firstSeq = options.firstSeq;
		this.pauseMs = pauseMs;
		this.timeOriginMs = origin;
		this.lastAtMs = origin;
		this.text = options.initialText;
		this.confirmedText = options.initialText;
	}

	/**
	 * Restore a saved monitor in a new clock session.
	 *
	 * @throws {TypeError} If the checkpoint, new clock or session identifier is invalid.
	 */
	static restore(options: {
		checkpoint: MonitorCheckpoint;
		now: () => number;
		createSessionId?: () => string;
	}): AnswerEditMonitor {
		requireRecord(options, "options");
		const state = parseCheckpoint(options.checkpoint);
		const createSessionId =
			options.createSessionId === undefined
				? () => crypto.randomUUID()
				: options.createSessionId;
		if (typeof createSessionId !== "function")
			throw new TypeError("createSessionId must be a function");
		const sessionId = createSessionId();
		requireId(sessionId, "sessionId");
		const knownSessions = new Set([
			state.active.sessionId,
			...state.queue.map((segment) => segment.sessionId),
			...state.receipts.map((receipt) => receiptSessionId(receipt.batchId)),
		]);
		if (state.inFlight) knownSessions.add(state.inFlight.sessionId);
		if (knownSessions.has(sessionId))
			throw new TypeError("Restored session id must be new");

		const monitor = new AnswerEditMonitor({
			initialText: state.text,
			sessionId,
			baseRevision: state.baseRevision,
			firstSeq: state.firstSeq,
			pauseMs: state.pauseMs,
			now: options.now,
		});
		monitor.confirmedText = state.confirmedText;
		monitor.inFlight = frozenCopy(state.inFlight);
		monitor.queue = state.queue;
		const active = state.active;
		const edits = active.openEdit
			? [...active.edits, active.openEdit.edit]
			: active.edits;
		if (edits.length > 0) {
			monitor.queue.push({
				sessionId: active.sessionId,
				timeOriginMs: active.timeOriginMs,
				edits,
				snapshot: state.text,
			});
		}
		for (const receipt of state.receipts)
			monitor.receipts.set(receipt.batchId, frozenCopy(receipt));
		return monitor;
	}

	/**
	 * Register an input intention and return the token that associates it with a later change.
	 *
	 * Only the latest 16 unconsumed observations are kept; older tokens become unknown.
	 *
	 * @throws {TypeError} If the observation is invalid or out of order.
	 * @throws {Error} If the monitor is disposed.
	 */
	observeInput(input: InputObservation): InputToken {
		this.requireActive();
		requireRecord(input, "input");
		requireKind(input.kind);
		const atMs = this.validateTime(input.atMs);
		const token = `${this.sessionId}#${this.nextInput++}`;
		this.observations.set(token, { atMs, kind: input.kind });
		if (this.observations.size > MAX_OBSERVATIONS) {
			const oldest = this.observations.keys().next().value;
			if (oldest !== undefined) this.observations.delete(oldest);
		}
		this.lastAtMs = atMs;
		this.notify();
		return token;
	}

	/**
	 * Validate and apply an entire canonical transaction before recording its edits.
	 *
	 * @throws {TypeError} If the transaction, time or input association is invalid.
	 * @throws {Error} If the monitor is disposed.
	 */
	recordChange(change: DocumentChange): void {
		this.requireActive();
		requireRecord(change, "change");
		requireKind(change.kind);
		const atMs = this.validateTime(change.atMs);
		const observation = this.associatedInput(change, atMs);
		const nextText = applyReplacements(this.text, change.replacements);
		const replacements = change.replacements
			.filter(
				(replacement) =>
					this.text.slice(
						replacement.position,
						replacement.position + replacement.deleteCount,
					) !== replacement.insertedText,
			)
			.map((replacement) => ({ ...replacement }));

		const metadataChanged = this.lastAtMs !== atMs || observation !== undefined;
		this.lastAtMs = atMs;
		if (change.input !== undefined) this.observations.delete(change.input);
		if (nextText === this.text) {
			if (metadataChanged) this.notify();
			return;
		}

		const interval = this.cadenceInterval(observation);
		const isolated =
			change.replacements.length !== 1 ||
			!isGroupable(change.kind, replacements[0]);
		if (isolated) this.finalizeEdit();
		/// Only a lone groupable replacement can merge, so isolated edits carry no timing.
		const timing: EditTiming | null =
			isolated || interval === null ? null : [1, interval, 0];
		for (const replacement of replacements.reverse()) {
			this.appendEdit(
				{
					...replacement,
					startMs: atMs,
					durationMs: 0,
					kind: change.kind,
					timing,
				},
				isolated,
			);
		}
		this.text = nextText;
		if (isolated) this.finalizeEdit();
		this.notify();
	}

	/**
	 * Finalize any open edit without collecting a batch.
	 *
	 * @throws {Error} If the monitor is disposed.
	 */
	closeEdit(): void {
		this.requireActive();
		if (!this.openEdit) return;
		this.finalizeEdit();
		this.notify();
	}

	/**
	 * Return an immutable view of the document and pending work.
	 */
	getState(): Readonly<MonitorState> {
		return Object.freeze({
			text: this.text,
			hasPendingChanges:
				this.inFlight !== null ||
				this.queue.length > 0 ||
				this.edits.length > 0 ||
				this.openEdit !== null,
			hasUnacknowledgedBatch: this.inFlight !== null,
		});
	}

	/**
	 * Freeze the next batch, or return the same unacknowledged batch on retries.
	 *
	 * @throws {TypeError} If the next revision or sequence would overflow.
	 * @throws {Error} If the monitor is disposed.
	 */
	collect(): Readonly<PendingEditBatch> | null {
		this.requireActive();
		if (this.inFlight) {
			if (this.openEdit) {
				this.finalizeEdit();
				this.notify();
			}
			return this.inFlight;
		}
		const segment = this.queue[0];
		const pending =
			segment?.edits ??
			(this.openEdit ? [...this.edits, this.openEdit.edit] : this.edits);
		if (pending.length === 0) return null;
		const timeOriginMs = segment?.timeOriginMs ?? this.timeOriginMs;
		const sessionId = segment?.sessionId ?? this.sessionId;
		const envelope = encodeEdits(pending, timeOriginMs);
		requireInteger(this.baseRevision + 1, "next revision");
		requireInteger(this.firstSeq + envelope.edits.length, "next sequence");
		for (const tuple of envelope.edits) {
			if (tuple[6]) Object.freeze(tuple[6]);
			Object.freeze(tuple);
		}
		Object.freeze(envelope.edits);
		this.inFlight = Object.freeze({
			...envelope,
			batchId: `${sessionId}:${this.firstSeq}`,
			sessionId,
			baseRevision: this.baseRevision,
			firstSeq: this.firstSeq,
			snapshot: segment?.snapshot ?? this.text,
		});
		if (segment) {
			this.queue.shift();
			this.finalizeEdit();
		} else {
			this.edits = [];
			this.openEdit = null;
		}
		const batch = this.inFlight;
		this.notify();
		return batch;
	}

	/**
	 * Confirm the in-flight batch atomically, accepting identical past receipts as retries.
	 *
	 * @throws {TypeError} If the receipt is invalid, conflicting or unknown, or counters overflow.
	 * @throws {Error} If the monitor is disposed.
	 */
	acknowledge(receipt: BatchReceipt): void {
		this.requireActive();
		requireRecord(receipt, "receipt");
		requireId(receipt.batchId, "receipt.batchId");
		requireInteger(receipt.revision, "receipt.revision");
		requireInteger(receipt.lastSeq, "receipt.lastSeq");
		const known = this.receipts.get(receipt.batchId);
		if (known) {
			if (
				known.revision !== receipt.revision ||
				known.lastSeq !== receipt.lastSeq
			)
				throw new TypeError("Receipt conflicts with an acknowledged batch");
			return;
		}
		const batch = this.inFlight;
		if (!batch || receipt.batchId !== batch.batchId)
			throw new TypeError("Receipt does not identify the in-flight batch");
		const nextRevision = batch.baseRevision + 1;
		const nextSeq = batch.firstSeq + batch.edits.length;
		requireInteger(nextRevision, "next revision");
		requireInteger(nextSeq, "next sequence");
		if (receipt.revision !== nextRevision || receipt.lastSeq !== nextSeq - 1)
			throw new TypeError(
				"Receipt revision or last sequence does not match the batch",
			);

		this.receipts.set(
			receipt.batchId,
			Object.freeze({
				batchId: receipt.batchId,
				revision: receipt.revision,
				lastSeq: receipt.lastSeq,
			}),
		);
		if (this.receipts.size > MAX_RECEIPTS) {
			const oldest = this.receipts.keys().next().value;
			if (oldest !== undefined) this.receipts.delete(oldest);
		}
		this.baseRevision = nextRevision;
		this.firstSeq = nextSeq;
		this.confirmedText = batch.snapshot;
		this.inFlight = null;
		this.notify();
	}

	/**
	 * Re-point the pending history at the server's revision and sequence, keeping every edit.
	 *
	 * Only valid while no batch is in flight and the server holds the text the history started from.
	 *
	 * @throws {TypeError} If a counter is invalid.
	 * @throws {Error} If the monitor is disposed or a batch is in flight.
	 */
	adoptBase(base: { baseRevision: number; firstSeq: number }): void {
		this.requireActive();
		if (this.inFlight)
			throw new Error("Cannot adopt a base with a batch in flight");
		requireInteger(base.baseRevision, "baseRevision");
		requireInteger(base.firstSeq, "firstSeq");
		this.baseRevision = base.baseRevision;
		this.firstSeq = base.firstSeq;
		this.receipts.clear();
		this.notify();
	}

	/**
	 * Adopt a new server baseline for the current text, discarding all pending history.
	 *
	 * @throws {TypeError} If a counter is invalid.
	 * @throws {Error} If the monitor is disposed.
	 */
	rebase(base: { baseRevision: number; firstSeq: number }): void {
		this.requireActive();
		requireInteger(base.baseRevision, "baseRevision");
		requireInteger(base.firstSeq, "firstSeq");
		this.baseRevision = base.baseRevision;
		this.firstSeq = base.firstSeq;
		this.confirmedText = this.text;
		this.queue = [];
		this.edits = [];
		this.openEdit = null;
		this.inFlight = null;
		this.receipts.clear();
		this.notify();
	}

	/**
	 * Export the document, pending edits and recent receipts for persistence.
	 */
	exportCheckpoint(): Readonly<MonitorCheckpoint> {
		return frozenCopy({
			version: 2,
			state: {
				baseRevision: this.baseRevision,
				firstSeq: this.firstSeq,
				pauseMs: this.pauseMs,
				confirmedText: this.confirmedText,
				text: this.text,
				receipts: [...this.receipts.values()],
				inFlight: this.inFlight,
				queue: this.queue,
				active: {
					sessionId: this.sessionId,
					timeOriginMs: this.timeOriginMs,
					lastAtMs: this.lastAtMs,
					edits: this.edits,
					openEdit: this.openEdit,
				},
			},
		});
	}

	/**
	 * Register synchronous immutable state notifications and return an unsubscribe function.
	 *
	 * @throws {TypeError} If the listener is not a function.
	 * @throws {Error} If the monitor is disposed.
	 */
	subscribe(listener: (state: Readonly<MonitorState>) => void): () => void {
		this.requireActive();
		if (typeof listener !== "function")
			throw new TypeError("listener must be a function");
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Stop accepting changes and clear listeners without discarding document or pending work.
	 */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.listeners.clear();
	}

	private requireActive(): void {
		if (this.disposed) throw new Error("Monitor is disposed");
	}

	private notify(): void {
		const state = this.getState();
		for (const listener of this.listeners) listener(state);
	}

	private finalizeEdit(): void {
		if (!this.openEdit) return;
		this.edits.push(this.openEdit.edit);
		this.openEdit = null;
	}

	/// Round an event time to whole milliseconds and check it against the session clock.
	private validateTime(atMs: number): number {
		const rounded = wholeMs(atMs, "atMs");
		if (rounded < this.lastAtMs)
			throw new TypeError("Event time must not regress or precede the origin");
		return rounded;
	}

	private associatedInput(
		change: DocumentChange,
		atMs: number,
	): InputObservation | undefined {
		if (change.input === undefined) return undefined;
		const observation = this.observations.get(change.input);
		if (!observation)
			throw new TypeError("Input must be observed and unconsumed");
		if (observation.kind !== change.kind || observation.atMs > atMs)
			throw new TypeError("Input kind and time must match the change");
		return observation;
	}

	private cadenceInterval(
		observation: InputObservation | undefined,
	): number | null {
		if (
			!observation ||
			(observation.kind !== "typing" && observation.kind !== "delete")
		) {
			this.previousCadenceMs = null;
			return null;
		}
		const previous = this.previousCadenceMs;
		this.previousCadenceMs = observation.atMs;
		return previous === null || observation.atMs < previous
			? null
			: observation.atMs - previous;
	}

	private appendEdit(edit: AnswerEdit, isolated: boolean): void {
		const open = this.openEdit;
		if (
			!isolated &&
			open &&
			edit.startMs - open.lastAtMs <= this.pauseMs &&
			(edit.timing === null || edit.timing[1] <= this.pauseMs)
		) {
			const merged = mergeEdits(open.edit, edit);
			if (merged) {
				this.openEdit = { edit: merged, lastAtMs: edit.startMs };
				return;
			}
		}
		this.finalizeEdit();
		this.openEdit = {
			edit: { ...edit, timing: null },
			lastAtMs: edit.startMs,
		};
	}
}

function requireRecord(value: unknown, name: string): void {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError(`${name} must be an object`);
}

function requireId(value: unknown, name: string): void {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError(`${name} must be a nonempty string`);
}

function requireTime(value: unknown, name: string): void {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
		throw new TypeError(`${name} must be a finite nonnegative number`);
}

/// Round a clock reading to whole milliseconds; `Math.round` is monotonic, so order and ties survive.
function wholeMs(value: unknown, name: string): number {
	requireTime(value, name);
	const rounded = Math.round(value as number);
	requireInteger(rounded, name);
	return rounded;
}

function requireInteger(value: unknown, name: string): void {
	requireTime(value, name);
	if (!Number.isSafeInteger(value))
		throw new TypeError(`${name} must be a safe integer`);
}

function requireKind(value: unknown): void {
	if (!INPUT_KINDS.includes(value as InputKind))
		throw new TypeError("Invalid input kind");
}

function isGroupable(
	kind: InputKind,
	replacement: TextReplacement | undefined,
): boolean {
	if (!replacement) return false;
	return (
		(kind === "typing" &&
			replacement.deleteCount === 0 &&
			replacement.insertedText.length > 0) ||
		(kind === "delete" &&
			replacement.deleteCount > 0 &&
			replacement.insertedText === "")
	);
}

function mergeEdits(previous: AnswerEdit, next: AnswerEdit): AnswerEdit | null {
	if (
		previous.kind !== next.kind ||
		!isGroupable(previous.kind, previous) ||
		!isGroupable(next.kind, next)
	)
		return null;
	let replacement: TextReplacement;
	if (
		previous.kind === "typing" &&
		next.position === previous.position + previous.insertedText.length
	) {
		replacement = {
			position: previous.position,
			deleteCount: 0,
			insertedText: previous.insertedText + next.insertedText,
		};
	} else if (
		previous.kind === "delete" &&
		(next.position === previous.position ||
			next.position + next.deleteCount === previous.position)
	) {
		replacement = {
			position: next.position,
			deleteCount: previous.deleteCount + next.deleteCount,
			insertedText: "",
		};
	} else {
		return null;
	}
	const timing = mergeTiming(previous.timing, next.timing);
	if (timing === undefined) return null;
	return {
		...previous,
		...replacement,
		durationMs: next.startMs - previous.startMs,
		timing,
	};
}

function mergeTiming(
	previous: EditTiming | null,
	next: EditTiming | null,
): EditTiming | null | undefined {
	if (!previous) return next;
	if (!next) return previous;
	const count = previous[0] + next[0];
	if (!Number.isSafeInteger(count)) return undefined;
	const delta = next[1] - previous[1];
	const nextWeight = next[0] / count;
	const mean = previous[1] + delta * nextWeight;
	/// Apply the weight before squaring to avoid unnecessary intermediate overflow.
	const correction = delta * (delta * (previous[0] * nextWeight));
	const m2 = previous[2] + next[2] + correction;
	/// An unrepresentable statistic closes the group without inventing a sample.
	if (!Number.isFinite(mean) || !Number.isFinite(m2)) return undefined;
	return [count, mean, m2];
}
