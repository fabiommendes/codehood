import {
	type AnswerEditCoordinator,
	type AttemptField,
	browserCoordinatorScheduler,
	type CoordinatorScheduler,
} from "./coordinator";
import { AnswerEditMonitor, type InputObservation } from "./monitor";

/// How the text changed, as the monitor classifies it.
type InputKind = InputObservation["kind"];

/// The slice of the coordinator the adapter calls.
export type CoordinatorPort = Pick<
	AnswerEditCoordinator,
	| "register"
	| "detach"
	| "persist"
	| "flush"
	| "dispose"
	| "reportGap"
	| "discard"
>;

/// A field whose monitoring stopped, with the reason, for an optional discreet indicator.
export interface AdapterGap {
	readonly field: AttemptField | null;
	readonly reason: string;
}

export interface AnswerEditAdapterOptions {
	readonly coordinator: CoordinatorPort;
	/// Monotonic milliseconds, on the clock the monitors use.
	readonly now: () => number;
	/// Drives deferred monitor work and the final-flush ceiling.
	readonly scheduler?: CoordinatorScheduler;
	readonly createSessionId?: () => string;
	/// Builds the monitor of a field, which must start from `initialText`.
	readonly createMonitor?: (init: {
		readonly initialText: string;
		readonly sessionId: string;
	}) => AnswerEditMonitor;
	/// Longest `flushFinal` holds its caller.
	readonly flushCeilingMs?: number;
	/// `false` makes the adapter inert from the start.
	readonly enabled?: boolean;
	readonly onGap?: (gap: AdapterGap) => void;
}

interface FieldEntry {
	readonly field: AttemptField;
	phase: "opening" | "ready" | "disabled" | "closed";
	/// The editor's text as of the last notification: the only source of truth.
	latestText: string;
	/// The text the monitor has been told about.
	appliedText: string;
	pendingKind: InputKind | null;
	pendingAtMs: number;
	lastAtMs: number;
	scheduled: boolean;
	monitor: AnswerEditMonitor | null;
}

const DEFAULT_FLUSH_CEILING_MS = 3000;

/// Longest `discard` holds its caller.
const DISCARD_CEILING_MS = 2000;

/**
 * The only entry point UI code uses to record the edit history of text answers.
 *
 * Nothing it does can throw into, delay or depend on the answer channel: every
 * call into the monitor, coordinator and store is guarded, the first failure
 * disables monitoring of that field, and the answer is never read back.
 *
 * Usage: save the answer through its own channel first, then call `input` with
 * the editor's text. Calling `attach` and `input` never waits for anything.
 *
 * @example
 * ```ts
 * adapter.attach(field, editor.value);      // fire and forget
 * saveAnswer(editor.value);                 // the answer channel first
 * adapter.input(field, editor.value, "paste");
 * await Promise.all([finish(), adapter.flushFinal()]);
 * ```
 */
export class AnswerEditAdapter {
	private readonly fields = new Map<string, FieldEntry>();
	private readonly failures: AdapterGap[] = [];
	private readonly coordinator: CoordinatorPort;
	private readonly scheduler: CoordinatorScheduler;
	private readonly now: () => number;
	private readonly createMonitor: NonNullable<
		AnswerEditAdapterOptions["createMonitor"]
	>;
	private readonly createSessionId: () => string;
	private readonly ceilingMs: number;
	private readonly onGap: AnswerEditAdapterOptions["onGap"];
	private killed: boolean;
	private sessions = 0;

	constructor(options: AnswerEditAdapterOptions) {
		this.coordinator = options.coordinator;
		this.now = options.now;
		this.scheduler = options.scheduler ?? browserCoordinatorScheduler();
		this.createSessionId =
			options.createSessionId ?? (() => `adapter-${++this.sessions}`);
		this.createMonitor =
			options.createMonitor ??
			(({ initialText, sessionId }) =>
				new AnswerEditMonitor({
					initialText,
					sessionId,
					baseRevision: 0,
					firstSeq: 1,
					now: options.now,
				}));
		this.ceilingMs = options.flushCeilingMs ?? DEFAULT_FLUSH_CEILING_MS;
		this.onGap = options.onGap;
		this.killed = options.enabled === false;
	}

	/**
	 * Start monitoring a field whose editor currently holds `text`, without waiting for storage or network.
	 *
	 * Edits made before the monitor is ready are not buffered: they reach it as
	 * one coalesced edit, from the editor's text at that moment.
	 */
	attach(field: AttemptField, text: string): void {
		if (this.killed) return;
		try {
			const key = fieldKey(field);
			if (this.fields.has(key)) return;
			if (typeof text !== "string")
				throw new TypeError("text must be a string");
			const entry: FieldEntry = {
				field: { questionId: field.questionId, field: field.field },
				phase: "opening",
				latestText: text,
				appliedText: text,
				pendingKind: null,
				pendingAtMs: 0,
				lastAtMs: 0,
				scheduled: false,
				monitor: null,
			};
			this.fields.set(key, entry);
			this.defer(() => void this.open(entry));
		} catch (error) {
			this.record(null, error);
		}
	}

	/**
	 * Tell the adapter the editor's text is now `text`; call it after the answer channel.
	 *
	 * Only stores the text: the monitor work runs later, off the input handler.
	 */
	input(field: AttemptField, text: string, kind: InputKind = "typing"): void {
		if (this.killed) return;
		let entry: FieldEntry | undefined;
		try {
			entry = this.fields.get(fieldKey(field));
			if (!entry || entry.phase === "disabled" || entry.phase === "closed")
				return;
			if (typeof text !== "string")
				throw new TypeError("text must be a string");
			if (text === entry.latestText) return;
			entry.latestText = text;
			if (entry.pendingKind === null) {
				entry.pendingKind = kind;
				entry.pendingAtMs = this.now();
			} else if (entry.pendingKind !== kind) {
				entry.pendingKind = "other";
			}
			if (entry.phase === "ready" && !entry.scheduled) {
				entry.scheduled = true;
				const target = entry;
				this.defer(() => this.drain(target));
			}
		} catch (error) {
			this.fail(entry, error);
		}
	}

	/**
	 * Stop monitoring a field the editor no longer shows, keeping its pending history for delivery.
	 */
	detach(field: AttemptField): void {
		try {
			const key = fieldKey(field);
			const entry = this.fields.get(key);
			if (!entry || entry.phase === "disabled" || entry.phase === "closed")
				return;
			const wasReady = entry.phase === "ready";
			if (wasReady) this.drain(entry);
			entry.phase = "closed";
			entry.monitor = null;
			this.fields.delete(key);
			/// A field still opening is detached by `open` once the coordinator answers.
			if (this.killed || !wasReady) return;
			this.guard(() => this.coordinator.detach(entry.field), null);
		} catch (error) {
			this.record(null, error);
		}
	}

	/**
	 * Send what is pending, resolving within the ceiling whatever storage and transport do; never rejects.
	 *
	 * Run it in parallel with the final submission, never before it.
	 */
	flushFinal(): Promise<void> {
		return new Promise<void>((resolve) => {
			if (this.killed || !this.hasLiveField()) return resolve();
			let done = false;
			let cancel: (() => void) | null = null;
			const finish = () => {
				if (done) return;
				done = true;
				try {
					cancel?.();
				} catch {
					/// Nothing to cancel.
				}
				resolve();
			};
			try {
				cancel = this.scheduler.schedule(this.ceilingMs, finish);
			} catch {
				/// Without a timer the ceiling cannot be enforced, so the caller is not held.
				return resolve();
			}
			try {
				for (const entry of this.fields.values()) this.drain(entry);
			} catch (error) {
				this.record(null, error);
			}
			this.guard(
				async () => {
					/// Wait for both, so a quick failure of one does not cut the other short.
					const results = await Promise.allSettled([
						this.coordinator.persist(),
						this.coordinator.flush({ afterReconciliation: true }),
					]);
					for (const result of results)
						if (result.status === "rejected") throw result.reason;
				},
				null,
				finish,
			);
		});
	}

	/**
	 * Kill switch: stop monitoring everything for good and make every later call a no-op.
	 */
	disable(reason = "disabled"): void {
		if (this.killed) return;
		this.killed = true;
		for (const entry of this.fields.values()) {
			if (entry.phase === "opening" || entry.phase === "ready")
				this.reportGap(entry.field, reason);
			entry.phase = "disabled";
			entry.monitor = null;
		}
		this.record(null, reason);
		this.guard(() => this.coordinator.dispose(), null);
	}

	/**
	 * Erase the local records of the attempt and stop for good, resolving within a ceiling whatever storage does; never rejects.
	 */
	discard(): Promise<void> {
		return new Promise<void>((resolve) => {
			let done = false;
			let cancel: (() => void) | null = null;
			const finish = () => {
				if (done) return;
				done = true;
				try {
					cancel?.();
				} catch {
					/// Nothing to cancel.
				}
				resolve();
			};
			this.killed = true;
			try {
				cancel = this.scheduler.schedule(DISCARD_CEILING_MS, finish);
			} catch {
				/// Without a timer the ceiling cannot be enforced, so the caller is not held.
				return resolve();
			}
			this.guard(() => this.coordinator.discard(), null, finish);
		});
	}

	/// Whether the adapter as a whole, or one field, is still monitored.
	isActive(field?: AttemptField): boolean {
		if (this.killed) return false;
		if (!field) return true;
		const phase = this.fields.get(fieldKey(field))?.phase;
		return phase === "opening" || phase === "ready";
	}

	/// Every monitoring failure so far, oldest first.
	gaps(): readonly AdapterGap[] {
		return [...this.failures];
	}

	private open(entry: FieldEntry): Promise<void> {
		if (this.killed || entry.phase !== "opening") return Promise.resolve();
		let monitor: AnswerEditMonitor;
		try {
			entry.appliedText = entry.latestText;
			monitor = this.createMonitor({
				initialText: entry.latestText,
				sessionId: this.createSessionId(),
			});
			/// Typing before this point happened before the monitor's clock started; it is recorded from here.
			entry.lastAtMs = Math.max(entry.lastAtMs, this.now());
		} catch (error) {
			this.fail(entry, error);
			return Promise.resolve();
		}
		return this.guard(async () => {
			await this.coordinator.register(entry.field, monitor);
			if (this.killed || entry.phase === "disabled") return;
			if (entry.phase === "closed") {
				await this.coordinator.detach(entry.field);
				return;
			}
			entry.monitor = monitor;
			entry.phase = "ready";
			if (entry.latestText !== entry.appliedText && !entry.scheduled) {
				entry.scheduled = true;
				this.defer(() => this.drain(entry));
			}
		}, entry);
	}

	/// Hand the monitor the difference between what it knows and the editor's text.
	private drain(entry: FieldEntry): void {
		entry.scheduled = false;
		if (this.killed || entry.phase !== "ready" || !entry.monitor) return;
		try {
			const text = entry.latestText;
			if (text === entry.appliedText) return;
			const replacement = diff(entry.appliedText, text);
			const atMs = Math.max(entry.pendingAtMs, entry.lastAtMs);
			entry.lastAtMs = atMs;
			const kind = entry.pendingKind ?? "other";
			entry.pendingKind = null;
			entry.monitor.recordChange({ atMs, kind, replacements: [replacement] });
			entry.appliedText = text;
		} catch (error) {
			this.fail(entry, error);
		}
	}

	/// Run `fn` so that neither a throw nor a rejection escapes; a failure disables `entry`, or everything when null.
	private guard(
		fn: () => unknown,
		entry: FieldEntry | null,
		settled?: () => void,
	): Promise<void> {
		let running: Promise<unknown>;
		try {
			running = Promise.resolve(fn());
		} catch (error) {
			running = Promise.reject(error);
		}
		return running.then(
			() => settled?.(),
			(error) => {
				if (entry) this.fail(entry, error);
				else this.record(null, error);
				settled?.();
			},
		);
	}

	private fail(entry: FieldEntry | undefined, error: unknown): void {
		if (!entry) {
			this.record(null, error);
			return;
		}
		if (entry.phase === "disabled") return;
		const wasClosed = entry.phase === "closed";
		entry.phase = "disabled";
		entry.monitor = null;
		this.record(entry.field, error);
		this.reportGap(
			entry.field,
			error instanceof Error ? error.message : String(error),
		);
		if (wasClosed || this.killed) return;
		/// Best effort: ownership of whatever is pending moves off the broken handle.
		this.guard(() => this.coordinator.detach(entry.field), null);
	}

	/// Tell the coordinator the field's history has a hole, so the server can show it.
	private reportGap(field: AttemptField, reason: string): void {
		try {
			this.coordinator.reportGap(field, reason);
		} catch {
			/// Reporting a gap must never break the caller.
		}
	}

	private record(field: AttemptField | null, error: unknown): void {
		const reason = error instanceof Error ? error.message : String(error);
		const gap = { field, reason };
		this.failures.push(gap);
		try {
			this.onGap?.(gap);
		} catch {
			/// An indicator must never break monitoring bookkeeping.
		}
	}

	private defer(callback: () => void): void {
		try {
			this.scheduler.schedule(0, callback);
		} catch (error) {
			this.record(null, error);
		}
	}

	private hasLiveField(): boolean {
		for (const entry of this.fields.values())
			if (entry.phase === "opening" || entry.phase === "ready") return true;
		return false;
	}
}

function fieldKey(field: AttemptField): string {
	return `${field.questionId}\u0000${field.field}`;
}

/// The single replacement turning `before` into `after`, from their common prefix and suffix.
function diff(before: string, after: string) {
	const limit = Math.min(before.length, after.length);
	let start = 0;
	while (start < limit && before.charCodeAt(start) === after.charCodeAt(start))
		start++;
	let end = 0;
	while (
		end < limit - start &&
		before.charCodeAt(before.length - 1 - end) ===
			after.charCodeAt(after.length - 1 - end)
	)
		end++;
	/// Never split a surrogate pair at either edge of the replaced range.
	if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
	if (end > 0 && isLowSurrogate(before.charCodeAt(before.length - end))) end--;
	return {
		position: start,
		deleteCount: before.length - start - end,
		insertedText: after.slice(start, after.length - end),
	};
}

function isHighSurrogate(code: number): boolean {
	return code >= 0xd800 && code <= 0xdbff;
}

function isLowSurrogate(code: number): boolean {
	return code >= 0xdc00 && code <= 0xdfff;
}
