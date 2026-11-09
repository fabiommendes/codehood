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
	private readonly baseRevision: number;
	private readonly firstSeq: number;
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
	 */
	observeInput(input: InputObservation): void {
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
	}

	/**
	 * Validate and apply an entire canonical transaction before recording its edits.
	 *
	 * @throws {TypeError} If the transaction, time or input association is invalid.
	 */
	recordChange(change: DocumentChange): void {
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

		this.lastAtMs = change.atMs;
		if (observation) this.consumedInputs.add(observation.id);
		if (nextText === this.text) return;

		const interval = this.cadenceInterval(observation);
		const isolated =
			change.replacements.length !== 1 ||
			!isGroupable(change.kind, replacements[0]);
		if (isolated) this.closeEdit();
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
		if (isolated) this.closeEdit();
	}

	/**
	 * Finalize any open edit without collecting a batch.
	 */
	closeEdit(): void {
		if (!this.openEdit) return;
		this.edits.push(this.openEdit.edit);
		this.openEdit = null;
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
	 */
	collect(): Readonly<PendingEditBatch> | null {
		this.closeEdit();
		if (this.inFlight) return this.inFlight;
		if (this.edits.length === 0) return null;
		const envelope = encodeEdits(this.edits, this.timeOriginMs);
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
		return this.inFlight;
	}

	acknowledge(_receipt: BatchReceipt): void {
		throw new Error("Not implemented");
	}
	exportCheckpoint(): Readonly<MonitorCheckpoint> {
		throw new Error("Not implemented");
	}
	subscribe(_listener: (state: Readonly<MonitorState>) => void): () => void {
		throw new Error("Not implemented");
	}
	dispose(): void {
		throw new Error("Not implemented");
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
		this.closeEdit();
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
