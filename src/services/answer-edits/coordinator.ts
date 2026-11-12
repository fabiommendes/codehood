import { parseCheckpoint } from "./checkpoint";
import {
	AnswerEditMonitor,
	type BatchReceipt,
	type MonitorCheckpoint,
	type MonitorHandle,
	type MonitorState,
	type PendingEditBatch,
} from "./monitor";
import { equivalentCheckpoints, reconcileCheckpoint } from "./reconciliation";
import {
	type EditStore,
	type FieldRef,
	LOCAL_EDIT_TTL_MS,
	type LocalEditRecord,
} from "./storage";

export type AttemptField = Omit<FieldRef, "attemptId">;
export interface ObservableMonitorHandle extends MonitorHandle {
	closeEdit(): void;
	rebase(base: { baseRevision: number; firstSeq: number }): void;
	adoptBase(base: { baseRevision: number; firstSeq: number }): void;
	subscribe(listener: (state: Readonly<MonitorState>) => void): () => void;
}
export interface ServerFieldState {
	readonly text: string;
	readonly revision: number;
	readonly nextSeq: number;
	readonly canWrite: boolean;
	readonly receipts: readonly BatchReceipt[];
}
export interface FieldBatch extends AttemptField {
	readonly batch: PendingEditBatch;
}
export type FieldResult = AttemptField &
	(
		| { readonly kind: "accepted"; readonly receipt: BatchReceipt }
		| {
				readonly kind: "conflict" | "closed" | "retry";
				readonly message?: string;
		  }
	);
export interface AttemptTransport {
	inspect(ref: FieldRef): Promise<ServerFieldState>;
	send(request: {
		readonly attemptId: string;
		readonly fields: readonly FieldBatch[];
	}): Promise<readonly FieldResult[]>;
}
export interface CoordinatorScheduler {
	schedule(delayMs: number, callback: () => void): () => void;
}
export interface FieldStatus extends AttemptField {
	readonly durability: "pending" | "durable" | "unavailable";
	readonly savedText: string | null;
	readonly historyGap: boolean;
	readonly delivery: "idle" | "pending" | "sending" | "blocked";
	readonly error: string | null;
}
/// Every open yields a usable handle; storage and server problems degrade it instead.
export interface FieldRecovery {
	readonly handle: ObservableMonitorHandle;
}
export interface CoordinatorOptions {
	readonly ownerId: string;
	readonly attemptId: string;
	/// The injected stores must be bound exclusively to ownerId.
	readonly store: EditStore;
	readonly transport: AttemptTransport;
	readonly scheduler: CoordinatorScheduler;
	readonly now: () => number;
	readonly monotonicNow: () => number;
	readonly random: () => number;
	readonly createSessionId: () => string;
	readonly onStatus?: (status: Readonly<FieldStatus>) => void;
	readonly ttlMs?: number;
	/// Storage calls that outlast this are treated as failed.
	readonly storageTimeoutMs?: number;
}

interface RegisteredField {
	readonly field: AttemptField;
	handle: ObservableMonitorHandle;
	unsubscribe: () => void;
	attached: boolean;
	owned: boolean;
	canWrite: boolean;
	/// Whether the baseline was checked against the server; deliveries wait for it.
	reconciled: boolean;
	reconciling: Promise<void> | null;
	/// The coordinator-owned handle this editor handle replaced, used to prove an in-flight batch was not lost.
	predecessor: ObservableMonitorHandle | null;
	principalReadError: string | null;
	generation: number | null;
	version: number;
	attemptedVersion: number;
	status: FieldStatus;
}

const MAX_FIELDS = 128;
const STORAGE_TIMEOUT_MS = 5000;
const PERSIST_DELAY_MS = 1000;
const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 60_000;

/**
 * Own local durability and aggregate delivery for one authenticated attempt.
 */
export class AnswerEditCoordinator {
	private readonly fields = new Map<string, RegisteredField>();
	private readonly registering = new Set<string>();
	private readonly handoffs = new Map<string, Promise<void>>();
	private readonly commits = new Map<RegisteredField, Promise<void>>();
	private retryBaseMs = 0;
	private deliveryFailed = false;
	/// Batches acknowledged so far; `flushDelivery` stops when a round adds none.
	private acknowledged = 0;
	private readonly options: CoordinatorOptions;
	private cancelPersist: (() => void) | null = null;
	private cancelDelivery: (() => void) | null = null;
	private persistence: Promise<void> | null = null;
	private delivery: Promise<void> | null = null;
	private disposal: Promise<void> | null = null;
	private revocation: Promise<void> | null = null;
	private stopped = false;
	private revoked = false;

	constructor(options: CoordinatorOptions) {
		this.options = options;
	}

	/**
	 * Return a coordinator-owned handle restored from local state, or from `initialText` when there is none.
	 *
	 * Never waits for the server: the baseline is reconciled in the background.
	 */
	async recover(
		field: AttemptField,
		initialText: string,
	): Promise<FieldRecovery> {
		return this.open(field, { initialText });
	}

	/**
	 * Register an editor-owned handle; its text wins over any stored state.
	 *
	 * Never waits for the server: the baseline is reconciled in the background.
	 */
	async register(
		field: AttemptField,
		handle: ObservableMonitorHandle,
	): Promise<FieldRecovery> {
		return this.open(field, { handle });
	}

	/**
	 * Transfer ownership before the adapter disposes its handle, retaining pending delivery.
	 */
	async detach(field: AttemptField): Promise<void> {
		this.requireActive();
		const key = fieldKey(field);
		const entry = this.fields.get(key);
		if (!entry?.attached) return this.handoffs.get(key);
		entry.handle.closeEdit();
		const clone = this.restore(entry.handle.exportCheckpoint());
		entry.unsubscribe();
		entry.handle = clone;
		entry.attached = false;
		entry.owned = true;
		this.listen(entry);
		this.changed(entry);
		const handoff = this.persistField(entry).finally(() => {
			if (this.handoffs.get(key) === handoff) this.handoffs.delete(key);
		});
		this.handoffs.set(key, handoff);
		await handoff;
	}

	/**
	 * Return status of the last completed local commit, not an optimistic save promise.
	 */
	getStatus(field: AttemptField): Readonly<FieldStatus> | null {
		const key = fieldKey(field);
		const status = this.fields.get(key)?.status;
		return status ? Object.freeze({ ...status }) : null;
	}

	/**
	 * Commit the latest view of all dirty fields without closing open edits.
	 */
	persist(): Promise<void> {
		if (this.revoked) return Promise.resolve();
		this.cancelPersist?.();
		this.cancelPersist = null;
		if (this.persistence) return this.persistence;
		for (const entry of this.fields.values()) {
			if (entry.status.durability === "unavailable")
				entry.attemptedVersion = -1;
		}
		this.persistence = this.persistDirty().finally(() => {
			this.persistence = null;
		});
		return this.persistence;
	}

	/**
	 * Collect and durably freeze one batch per dirty field before one aggregate request.
	 */
	flush(): Promise<void> {
		if (this.stopped || this.revoked) return Promise.resolve();
		if (this.delivery) return this.delivery;
		this.cancelDelivery?.();
		this.cancelDelivery = null;
		this.delivery = this.sendPending().finally(() => {
			this.delivery = null;
			this.cancelDelivery?.();
			this.cancelDelivery = null;
			this.scheduleDelivery();
		});
		return this.delivery;
	}

	/**
	 * Drain pending batches while progress is accepted, stopping at failure or a closed deadline.
	 */
	async flushDelivery(): Promise<void> {
		while (!this.stopped && !this.revoked) {
			const before = this.acknowledged;
			await this.flush();
			if (this.deliveryFailed || before === this.acknowledged) return;
		}
	}

	/**
	 * Stop scheduling and retain local work without clearing it or extending deadlines.
	 */
	dispose(): Promise<void> {
		if (this.disposal) return this.disposal;
		this.stopped = true;
		this.stopCallbacks();
		this.disposal = this.persist().then(() => {
			for (const entry of this.fields.values()) {
				if (entry.owned && entry.handle instanceof AnswerEditMonitor)
					entry.handle.dispose();
			}
		});
		return this.disposal;
	}

	/**
	 * Fence old callbacks immediately, then erase only this owner's local data.
	 */
	logout(): Promise<void> {
		if (this.revocation) return this.revocation;
		this.revoked = true;
		this.stopped = true;
		this.stopCallbacks();
		/// The revocation begins synchronously so the store cannot be repopulated.
		this.revocation = this.options.store.revoke().then(
			() => undefined,
			(error: unknown) => {
				/// A failed cleanup must be retryable by calling logout again.
				this.revocation = null;
				throw error;
			},
		);
		return this.revocation;
	}

	private async open(
		field: AttemptField,
		source: { handle?: ObservableMonitorHandle; initialText?: string },
	): Promise<FieldRecovery> {
		this.requireActive();
		const key = fieldKey(field);
		const previous = this.fields.get(key);
		if (previous?.attached || this.registering.has(key))
			throw new Error("Field already has an active handle");
		if (previous && !source.handle) {
			previous.attached = true;
			this.publish(previous);
			if (!previous.reconciled) void this.reconcile(previous);
			return { handle: previous.handle };
		}
		if (!previous && this.fields.size + this.registering.size >= MAX_FIELDS)
			throw new RangeError("Too many registered fields");
		this.registering.add(key);
		try {
			if (previous) await this.persistField(previous);
			this.requireActive();
			const ref = this.ref(field);
			let local: LocalEditRecord | null = null;
			let readError: string | null = null;
			try {
				local = await this.bounded(
					this.options.store.read(ref, this.options.now()),
				);
			} catch (error) {
				readError = errorMessage(error);
			}
			this.requireActive();
			let gap = (previous?.status.historyGap ?? false) || readError !== null;
			let restored: AnswerEditMonitor | null = null;
			if (local && !source.handle) {
				try {
					restored = this.restore(local.checkpoint);
				} catch {
					gap = true;
				}
			}
			let monitor: ObservableMonitorHandle;
			if (source.handle) {
				monitor = source.handle;
				if (local && hasPendingEvidence(local.checkpoint))
					gap ||= !sameEvidence(local.checkpoint, monitor.exportCheckpoint());
			} else {
				monitor = restored ?? this.fresh(source.initialText ?? "");
			}
			const entry: RegisteredField = {
				field: { ...field },
				handle: monitor,
				unsubscribe: () => {},
				attached: true,
				owned: !source.handle,
				canWrite: true,
				reconciled: false,
				reconciling: null,
				predecessor: previous?.handle ?? null,
				principalReadError: previous?.principalReadError ?? readError,
				generation: previous?.generation ?? local?.generation ?? null,
				version: 1,
				attemptedVersion: 0,
				status: {
					...field,
					durability: "pending",
					savedText: previous?.status.savedText ?? local?.text ?? null,
					historyGap: gap,
					delivery: monitor.getState().hasPendingChanges ? "pending" : "idle",
					error: null,
				},
			};
			previous?.unsubscribe();
			this.fields.set(key, entry);
			this.listen(entry);
			this.publish(entry);
			this.schedulePersistence();
			this.scheduleDelivery();
			void this.reconcile(entry);
			return { handle: monitor };
		} finally {
			this.registering.delete(key);
		}
	}

	/// A monitor whose baseline is unknown until the first reconciliation.
	private fresh(text: string): AnswerEditMonitor {
		return new AnswerEditMonitor({
			initialText: text,
			baseRevision: 0,
			firstSeq: 0,
			sessionId: this.options.createSessionId(),
			now: this.options.monotonicNow,
		});
	}

	/// Check the entry's baseline against the server in the background, rebasing on divergence.
	private reconcile(entry: RegisteredField, force = false): Promise<void> {
		if (entry.reconciling) return entry.reconciling;
		entry.reconciling = this.inspectAndAdopt(entry, force)
			.catch(ignoreScheduled)
			.finally(() => {
				entry.reconciling = null;
				this.scheduleDelivery();
			});
		return entry.reconciling;
	}

	private async inspectAndAdopt(
		entry: RegisteredField,
		force: boolean,
	): Promise<void> {
		let server: ServerFieldState;
		/// Inspect only while no delivery runs, or its ACK could land after the snapshot.
		do {
			await this.delivery?.catch(ignoreScheduled);
			if (!this.isCurrent(entry)) return;
			server = await this.options.transport.inspect(this.ref(entry.field));
			if (!this.isCurrent(entry)) return;
		} while (this.delivery);
		entry.canWrite = server.canWrite;
		const reconciled = reconcileCheckpoint(
			entry.handle.exportCheckpoint(),
			server,
		);
		if (reconciled.receipt) entry.handle.acknowledge(reconciled.receipt);
		if (force || reconciled.reason) {
			const base = { baseRevision: server.revision, firstSeq: server.nextSeq };
			const state = entry.handle.getState();
			const history = reconciled.state;
			if (
				!force &&
				history.inFlight === null &&
				(server.text === history.confirmedText ||
					(server.revision === 0 && history.baseRevision === 0))
			) {
				/// The server holds what the history started from: keep every pending edit.
				entry.handle.adoptBase(base);
			} else {
				const lossless =
					(!state.hasPendingChanges && state.text === server.text) ||
					this.continuesPredecessor(entry, server);
				entry.handle.rebase(base);
				if (!lossless) entry.status = { ...entry.status, historyGap: true };
			}
			entry.version++;
			this.schedulePersistence();
		}
		entry.predecessor = null;
		entry.reconciled = true;
		entry.status = {
			...entry.status,
			delivery: !entry.canWrite
				? "blocked"
				: entry.handle.getState().hasPendingChanges
					? "pending"
					: "idle",
		};
		this.publish(entry);
		this.scheduleDelivery();
	}

	/// Whether the editor handle carries the text of an acknowledged predecessor, so the server already holds its history.
	private continuesPredecessor(
		entry: RegisteredField,
		server: ServerFieldState,
	): boolean {
		const previous = entry.predecessor;
		if (!previous) return false;
		try {
			const state = previous.getState();
			return (
				state.text === entry.handle.getState().text &&
				!state.hasPendingChanges &&
				reconcileCheckpoint(previous.exportCheckpoint(), server).reason === null
			);
		} catch {
			return false;
		}
	}

	/// Bound a storage call so a hung store degrades like an unavailable one.
	private bounded<T>(work: Promise<T>): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const cancel = this.options.scheduler.schedule(
				this.options.storageTimeoutMs ?? STORAGE_TIMEOUT_MS,
				() => reject(new Error("Storage timed out")),
			);
			work.then(resolve, reject).finally(cancel);
		});
	}

	private isCurrent(entry: RegisteredField): boolean {
		return (
			!this.stopped &&
			!this.revoked &&
			this.fields.get(fieldKey(entry.field)) === entry
		);
	}

	private restore(
		checkpoint: Parameters<typeof AnswerEditMonitor.restore>[0]["checkpoint"],
	): AnswerEditMonitor {
		return AnswerEditMonitor.restore({
			checkpoint,
			now: this.options.monotonicNow,
			createSessionId: this.options.createSessionId,
		});
	}

	private listen(entry: RegisteredField): void {
		entry.unsubscribe = entry.handle.subscribe(() => {
			if (this.stopped || this.revoked) return;
			this.changed(entry);
		});
	}

	private changed(entry: RegisteredField): void {
		entry.version++;
		entry.status = {
			...entry.status,
			durability: "pending",
			delivery: !entry.canWrite
				? "blocked"
				: entry.status.delivery === "sending"
					? "sending"
					: entry.handle.getState().hasPendingChanges
						? "pending"
						: "idle",
		};
		this.publish(entry);
		this.schedulePersistence();
		this.scheduleDelivery();
	}

	private async persistDirty(): Promise<void> {
		while (!this.revoked) {
			const dirty = [...this.fields.values()].filter(
				(entry) => entry.version !== entry.attemptedVersion,
			);
			if (dirty.length === 0) return;
			await Promise.all(dirty.map((entry) => this.persistField(entry)));
		}
	}

	private async persistField(entry: RegisteredField): Promise<void> {
		while (!this.revoked && entry.version !== entry.attemptedVersion) {
			let commit = this.commits.get(entry);
			if (!commit) {
				commit = this.commit(entry).finally(() => {
					this.commits.delete(entry);
				});
				this.commits.set(entry, commit);
			}
			await commit;
		}
	}

	private async commit(entry: RegisteredField): Promise<void> {
		const version = entry.version;
		const savedAt = this.options.now();
		const expiresAt = savedAt + (this.options.ttlMs ?? LOCAL_EDIT_TTL_MS);
		let record: LocalEditRecord;
		try {
			const checkpoint = entry.handle.exportCheckpoint();
			const state = parseCheckpoint(checkpoint);
			record = {
				version: 1,
				generation: (entry.generation ?? 0) + 1,
				savedAt,
				expiresAt,
				text: state.text,
				checkpoint,
				outbox: state.inFlight,
			};
		} catch (error) {
			this.recordFailure(entry, version, error);
			return;
		}
		try {
			if (entry.principalReadError) throw new Error(entry.principalReadError);
			await this.bounded(
				this.options.store.commit(
					this.ref(entry.field),
					record,
					entry.generation,
				),
			);
			if (this.revoked) return;
			entry.generation = record.generation;
			entry.status = {
				...entry.status,
				durability: version === entry.version ? "durable" : "pending",
				savedText: record.text,
				historyGap: false,
				error: null,
			};
		} catch (error) {
			if (this.revoked) return;
			this.recordFailure(entry, version, error);
			return;
		}
		entry.attemptedVersion = version;
		this.publish(entry);
	}

	/// Report why the record was not saved; the history has a gap from here, the answer is unaffected.
	private recordFailure(
		entry: RegisteredField,
		version: number,
		error: unknown,
	): void {
		entry.status = {
			...entry.status,
			durability: "unavailable",
			historyGap: true,
			error: errorMessage(error),
		};
		entry.attemptedVersion = version;
		this.publish(entry);
	}

	private async sendPending(): Promise<void> {
		this.deliveryFailed = false;
		for (const entry of this.fields.values())
			if (!entry.reconciled) void this.reconcile(entry);
		const pending: { entry: RegisteredField; batch: PendingEditBatch }[] = [];
		for (const entry of this.fields.values()) {
			if (
				this.registering.has(fieldKey(entry.field)) ||
				!entry.canWrite ||
				!entry.reconciled
			)
				continue;
			const batch = entry.handle.collect();
			if (batch) {
				/// Retried frozen batches are committed again before sending, when storage allows it.
				this.changed(entry);
				pending.push({ entry, batch });
			}
		}
		await this.persist();
		if (this.stopped || this.revoked) return;
		/// A failed primary commit does not hold the batch back: the server is the most durable store left.
		const sendable = pending.filter(
			({ entry }) => entry.canWrite && entry.reconciled,
		);
		if (sendable.length === 0) return;
		for (const { entry } of sendable) {
			entry.status = { ...entry.status, delivery: "sending" };
			this.publish(entry);
		}
		try {
			const results = await this.options.transport.send({
				attemptId: this.options.attemptId,
				fields: sendable.map(({ entry, batch }) => ({ ...entry.field, batch })),
			});
			if (this.stopped || this.revoked) return;
			for (const { entry } of sendable) {
				const matches = results.filter(
					(result) => fieldKey(result) === fieldKey(entry.field),
				);
				const result = matches.length === 1 ? matches[0] : undefined;
				if (result?.kind === "accepted") {
					try {
						entry.handle.acknowledge(result.receipt);
						this.acknowledged++;
						this.changed(entry);
					} catch (error) {
						entry.status = {
							...entry.status,
							delivery: "pending",
							error: errorMessage(error),
						};
					}
				} else if (result?.kind === "closed") {
					entry.canWrite = false;
					entry.status = {
						...entry.status,
						delivery: "blocked",
						error: result.message ?? result.kind,
					};
				} else if (result?.kind === "conflict") {
					entry.reconciled = false;
					entry.status = {
						...entry.status,
						delivery: "pending",
						error: result.message ?? result.kind,
					};
					void this.reconcile(entry, true);
				} else {
					entry.status = {
						...entry.status,
						delivery: "pending",
						error: result?.message ?? "Delivery not acknowledged",
					};
				}
				if (entry.status.delivery === "sending")
					entry.status = {
						...entry.status,
						delivery: entry.handle.getState().hasPendingChanges
							? "pending"
							: "idle",
					};
				this.publish(entry);
			}
			this.deliveryFailed = sendable.some(
				({ entry }) =>
					entry.status.delivery === "pending" && entry.status.error !== null,
			);
			this.updateRetry();
			await this.persist();
		} catch (error) {
			if (this.stopped || this.revoked) return;
			this.deliveryFailed = true;
			this.updateRetry();
			for (const { entry } of sendable) {
				entry.status = {
					...entry.status,
					delivery: "pending",
					error: errorMessage(error),
				};
				this.publish(entry);
			}
		}
	}

	private updateRetry(failed = this.deliveryFailed): void {
		this.retryBaseMs = failed
			? this.retryBaseMs === 0
				? INITIAL_RETRY_MS
				: Math.min(MAX_RETRY_MS, this.retryBaseMs * 2)
			: 0;
	}

	private schedulePersistence(): void {
		if (this.stopped || this.revoked || this.cancelPersist || this.persistence)
			return;
		this.cancelPersist = this.options.scheduler.schedule(
			PERSIST_DELAY_MS,
			() => {
				this.cancelPersist = null;
				if (!this.stopped && !this.revoked)
					this.persist().catch(ignoreScheduled);
			},
		);
	}

	private scheduleDelivery(): void {
		if (this.stopped || this.revoked || this.cancelDelivery || this.delivery)
			return;
		if (
			![...this.fields.values()].some(
				(entry) =>
					(!entry.reconciled && !entry.reconciling) ||
					(entry.canWrite && entry.handle.getState().hasPendingChanges),
			)
		)
			return;
		this.cancelDelivery = this.options.scheduler.schedule(
			this.retryBaseMs > 0
				? this.retryBaseMs * (0.5 + this.options.random())
				: 55_000 + this.options.random() * 10_000,
			() => {
				this.cancelDelivery = null;
				if (!this.stopped && !this.revoked) this.flush().catch(ignoreScheduled);
			},
		);
	}

	private stopCallbacks(): void {
		this.cancelPersist?.();
		this.cancelDelivery?.();
		this.cancelPersist = null;
		this.cancelDelivery = null;
		for (const entry of this.fields.values()) entry.unsubscribe();
	}

	private publish(entry: RegisteredField): void {
		this.publishStatus(entry.status);
	}

	private publishStatus(status: FieldStatus): void {
		if (this.revoked) return;
		try {
			this.options.onStatus?.(Object.freeze({ ...status }));
		} catch {
			/// Status consumers must not interrupt the editor's synchronous notification.
		}
	}

	private ref(field: AttemptField): FieldRef {
		return { attemptId: this.options.attemptId, ...field };
	}

	private requireActive(): void {
		if (this.stopped || this.revoked) throw new Error("Coordinator is stopped");
	}
}

function fieldKey(field: AttemptField): string {
	return JSON.stringify([field.questionId, field.field]);
}

/// Scheduled runs have no caller to reject to; failures are already reflected in field statuses.
function ignoreScheduled(): void {}

/// Whether a checkpoint holds history the server has not acknowledged; unreadable counts as yes.
function hasPendingEvidence(checkpoint: MonitorCheckpoint): boolean {
	try {
		const state = parseCheckpoint(checkpoint);
		return (
			state.inFlight !== null ||
			state.queue.length > 0 ||
			state.active.edits.length > 0 ||
			state.active.openEdit !== null
		);
	} catch {
		return true;
	}
}

/// Equivalence that treats an unparseable checkpoint as different.
function sameEvidence(
	left: MonitorCheckpoint,
	right: MonitorCheckpoint,
): boolean {
	try {
		return equivalentCheckpoints(left, right);
	} catch {
		return false;
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Adapt browser timers outside the monitor core. */
export function browserCoordinatorScheduler(): CoordinatorScheduler {
	return {
		schedule(delayMs, callback) {
			const timer = setTimeout(callback, delayMs);
			return () => clearTimeout(timer);
		},
	};
}
