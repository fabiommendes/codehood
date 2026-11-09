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
export interface InputObservation {
	readonly id: string;
	readonly atMs: number;
	readonly kind: InputKind;
}
export interface DocumentChange {
	readonly atMs: number;
	readonly inputId?: string;
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
	readonly version: 1;
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
	private lastAtMs: number;
	private readonly observations = new Map<string, InputObservation>();
	private readonly consumedInputs = new Set<string>();
	private previousCadenceMs: number | null = null;
	private openEdit: OpenEdit | null = null;
	private edits: AnswerEdit[] = [];
	private inFlight: Readonly<PendingEditBatch> | null = null;
	private readonly receipts = new Map<string, Readonly<BatchReceipt>>();
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
		const origin = options.now();
		requireTime(origin, "timeOriginMs");
		this.sessionId = options.sessionId;
		this.baseRevision = options.baseRevision;
		this.firstSeq = options.firstSeq;
		this.pauseMs = pauseMs;
		this.timeOriginMs = origin;
		this.lastAtMs = origin;
		this.text = options.initialText;
	}

	/**
	 * Restore a saved monitor in a new clock session.
	 *
	 * @throws {Error} Checkpoint restoration is not implemented.
	 */
	static restore(_options: {
		checkpoint: MonitorCheckpoint;
		now: () => number;
		createSessionId?: () => string;
	}): AnswerEditMonitor {
		throw new Error("Not implemented");
	}

	/**
	 * Register an input intention without changing the document or emitting an edit.
	 *
	 * @throws {TypeError} If the observation is invalid, duplicated or out of order.
	 * @throws {Error} If the monitor is disposed.
	 */
	observeInput(input: InputObservation): void {
		this.requireActive();
		requireRecord(input, "input");
		requireId(input.id, "input.id");
		requireKind(input.kind);
		this.validateTime(input.atMs);
		if (this.observations.has(input.id))
			throw new TypeError("Input id already observed");
		this.observations.set(input.id, {
			id: input.id,
			atMs: input.atMs,
			kind: input.kind,
		});
		this.lastAtMs = input.atMs;
		this.notify();
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
		this.validateTime(change.atMs);
		const observation = this.associatedInput(change);
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

		const metadataChanged =
			this.lastAtMs !== change.atMs || observation !== undefined;
		this.lastAtMs = change.atMs;
		if (observation) this.consumedInputs.add(observation.id);
		if (nextText === this.text) {
			if (metadataChanged) this.notify();
			return;
		}

		const interval = this.cadenceInterval(observation);
		const isolated =
			change.replacements.length !== 1 ||
			!isGroupable(change.kind, replacements[0]);
		if (isolated) this.finalizeEdit();
		let timing: EditTiming | null = interval === null ? null : [1, interval, 0];
		for (const replacement of replacements.reverse()) {
			this.appendEdit(
				{
					...replacement,
					startMs: change.atMs,
					durationMs: 0,
					kind: change.kind,
					timing,
				},
				isolated,
			);
			timing = null;
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
		if (this.inFlight) return this.inFlight;
		const pending = this.openEdit
			? [...this.edits, this.openEdit.edit]
			: this.edits;
		if (pending.length === 0) return null;
		const envelope = encodeEdits(pending, this.timeOriginMs);
		requireInteger(this.baseRevision + 1, "next revision");
		requireInteger(this.firstSeq + envelope.edits.length, "next sequence");
		for (const tuple of envelope.edits) {
			if (tuple[6]) Object.freeze(tuple[6]);
			Object.freeze(tuple);
		}
		Object.freeze(envelope.edits);
		this.inFlight = Object.freeze({
			...envelope,
			batchId: `${this.sessionId}:${this.firstSeq}`,
			sessionId: this.sessionId,
			baseRevision: this.baseRevision,
			firstSeq: this.firstSeq,
			snapshot: this.text,
		});
		this.edits = [];
		this.openEdit = null;
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
		this.baseRevision = nextRevision;
		this.firstSeq = nextSeq;
		this.inFlight = null;
		this.notify();
	}

	/**
	 * Export the document, pending edits and session metadata for persistence.
	 *
	 * @throws {Error} Checkpoint export is not implemented.
	 */
	exportCheckpoint(): Readonly<MonitorCheckpoint> {
		throw new Error("Not implemented");
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

	private validateTime(atMs: number): void {
		requireTime(atMs, "atMs");
		if (atMs < this.lastAtMs)
			throw new TypeError("Event time must not regress or precede the origin");
	}

	private associatedInput(
		change: DocumentChange,
	): InputObservation | undefined {
		if (change.inputId === undefined) return undefined;
		requireId(change.inputId, "inputId");
		const observation = this.observations.get(change.inputId);
		if (!observation || this.consumedInputs.has(change.inputId))
			throw new TypeError("Input must be observed and unconsumed");
		if (observation.kind !== change.kind || observation.atMs > change.atMs)
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
		if (!isolated && open && edit.startMs - open.lastAtMs <= this.pauseMs) {
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
	return {
		...previous,
		...replacement,
		durationMs: next.startMs - previous.startMs,
		timing: mergeTiming(previous.timing, next.timing),
	};
}

function mergeTiming(
	previous: EditTiming | null,
	next: EditTiming | null,
): EditTiming | null {
	if (!previous) return next;
	if (!next) return previous;
	const count = previous[0] + next[0];
	const delta = next[1] - previous[1];
	return [
		count,
		previous[1] + (delta * next[0]) / count,
		previous[2] + next[2] + (delta * delta * previous[0] * next[0]) / count,
	];
}
