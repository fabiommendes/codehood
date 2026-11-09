import { parseCheckpoint } from "./checkpoint";
import {
	AnswerEditMonitor,
	type BatchReceipt,
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
	type TextRecoveryStore,
} from "./storage";

export type AttemptField = Omit<FieldRef, "attemptId">;
export interface ObservableMonitorHandle extends MonitorHandle {
	closeEdit(): void;
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
	readonly durability:
		| "pending"
		| "durable"
		| "text-only"
		| "unavailable"
		| "conflict";
	readonly savedText: string | null;
	readonly historyGap: boolean;
	readonly delivery: "idle" | "pending" | "sending" | "blocked";
	readonly error: string | null;
}
export type FieldRecovery =
	| {
			readonly kind: "ready";
			readonly handle: ObservableMonitorHandle;
			readonly canWrite: boolean;
	  }
	| {
			readonly kind: "conflict";
			readonly localText: string;
			readonly server: ServerFieldState;
			readonly reason: string;
	  }
	| {
			readonly kind: "text-only";
			readonly localText: string;
			readonly server: ServerFieldState;
			readonly historyGap: true;
	  };
export interface CoordinatorOptions {
	readonly ownerId: string;
	readonly attemptId: string;
	/// The injected stores must be bound exclusively to ownerId.
	readonly store: EditStore;
	readonly fallback: TextRecoveryStore;
	readonly transport: AttemptTransport;
	readonly scheduler: CoordinatorScheduler;
	readonly now: () => number;
	readonly monotonicNow: () => number;
	readonly random: () => number;
	readonly createSessionId: () => string;
	readonly onStatus?: (status: Readonly<FieldStatus>) => void;
	readonly ttlMs?: number;
}

interface RegisteredField {
	readonly field: AttemptField;
	handle: ObservableMonitorHandle;
	unsubscribe: () => void;
	attached: boolean;
	owned: boolean;
	canWrite: boolean;
	generation: number | null;
	version: number;
	attemptedVersion: number;
	status: FieldStatus;
}

const MAX_FIELDS = 128;
const PERSIST_DELAY_MS = 1000;

/**
 * Own local durability and aggregate delivery for one authenticated attempt.
 */
export class AnswerEditCoordinator {
	private readonly fields = new Map<string, RegisteredField>();
	private readonly registering = new Set<string>();
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
	 * Inspect the server before restoring a checkpoint or creating a new field.
	 */
	async recover(field: AttemptField): Promise<FieldRecovery> {
		return this.open(field);
	}

	/**
	 * Register an editor-owned handle after reconciling its base with the server.
	 */
	async register(
		field: AttemptField,
		handle: ObservableMonitorHandle,
	): Promise<FieldRecovery> {
		return this.open(field, handle);
	}

	/**
	 * Transfer ownership before the adapter disposes its handle, retaining pending delivery.
	 */
	async detach(field: AttemptField): Promise<void> {
		this.requireActive();
		const entry = this.fields.get(fieldKey(field));
		if (!entry?.attached) return;
		entry.handle.closeEdit();
		const clone = this.restore(entry.handle.exportCheckpoint());
		entry.unsubscribe();
		entry.handle = clone;
		entry.attached = false;
		entry.owned = true;
		this.listen(entry);
		this.changed(entry);
		await this.persist();
	}

	/**
	 * Return status of the last completed local commit, not an optimistic save promise.
	 */
	getStatus(field: AttemptField): Readonly<FieldStatus> | null {
		const entry = this.fields.get(fieldKey(field));
		return entry ? Object.freeze({ ...entry.status }) : null;
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
			if (
				entry.status.durability === "text-only" ||
				entry.status.durability === "unavailable"
			)
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
			this.scheduleDelivery();
		});
		return this.delivery;
	}

	/**
	 * Drain pending batches while progress is accepted, stopping at failure or a closed deadline.
	 */
	async flushDelivery(): Promise<void> {
		while (!this.stopped && !this.revoked) {
			const before = this.progressKey();
			await this.flush();
			if (before === this.progressKey()) return;
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
		/// Both revocations begin synchronously so neither store can be repopulated.
		const principal = this.options.store.revoke();
		let fallback: Promise<void>;
		try {
			this.options.fallback.revoke();
			fallback = Promise.resolve();
		} catch (error) {
			fallback = Promise.reject(error);
		}
		this.revocation = Promise.all([principal, fallback]).then(() => undefined);
		return this.revocation;
	}

	private async open(
		field: AttemptField,
		handle?: ObservableMonitorHandle,
	): Promise<FieldRecovery> {
		this.requireActive();
		const key = fieldKey(field);
		const previous = this.fields.get(key);
		if (previous?.attached || this.registering.has(key))
			throw new Error("Field already has an active handle");
		if (!previous && this.fields.size + this.registering.size >= MAX_FIELDS)
			throw new RangeError("Too many registered fields");
		this.registering.add(key);
		try {
			const ref = this.ref(field);
			const server = await this.options.transport.inspect(ref);
			this.requireActive();
			let local: LocalEditRecord | null = null;
			try {
				local = await this.options.store.read(ref, this.options.now());
			} catch {
				/// Text recovery remains usable when the principal store cannot be read.
			}
			this.requireActive();
			if (!previous && !local && !handle) {
				const fallback = this.options.fallback.read(ref, this.options.now());
				if (fallback)
					return {
						kind: "text-only",
						localText: fallback.text,
						server,
						historyGap: true,
					};
			}
			const checkpoint =
				previous?.handle.exportCheckpoint() ?? local?.checkpoint;
			if (
				previous &&
				handle &&
				!equivalentCheckpoints(
					previous.handle.exportCheckpoint(),
					handle.exportCheckpoint(),
				)
			)
				return this.conflict(
					field,
					handle.getState().text,
					server,
					"Detached pending history diverged",
				);
			const candidate = handle?.exportCheckpoint() ?? checkpoint;
			const reconciled = candidate
				? reconcileCheckpoint(candidate, server)
				: null;
			if (reconciled?.reason)
				return this.conflict(
					field,
					reconciled.state.text,
					server,
					reconciled.reason,
				);
			if (
				handle &&
				local &&
				!previous &&
				!equivalentCheckpoints(local.checkpoint, handle.exportCheckpoint())
			)
				return this.conflict(
					field,
					local.text,
					server,
					"Stored pending history diverged",
				);
			const monitor =
				handle ??
				(candidate
					? this.restore(candidate)
					: new AnswerEditMonitor({
							initialText: server.text,
							baseRevision: server.revision,
							firstSeq: server.nextSeq,
							sessionId: this.options.createSessionId(),
							now: this.options.monotonicNow,
						}));
			if (reconciled?.receipt) monitor.acknowledge(reconciled.receipt);
			previous?.unsubscribe();
			const entry: RegisteredField = {
				field: { ...field },
				handle: monitor,
				unsubscribe: () => {},
				attached: true,
				owned: !handle,
				canWrite: server.canWrite,
				generation: previous?.generation ?? local?.generation ?? null,
				version: 1,
				attemptedVersion: 0,
				status: {
					...field,
					durability: "pending",
					savedText: previous?.status.savedText ?? local?.text ?? null,
					historyGap: previous?.status.historyGap ?? false,
					delivery: !server.canWrite
						? "blocked"
						: monitor.getState().hasPendingChanges
							? "pending"
							: "idle",
					error: null,
				},
			};
			this.fields.set(key, entry);
			this.listen(entry);
			this.publish(entry);
			this.schedulePersistence();
			this.scheduleDelivery();
			return { kind: "ready", handle: monitor, canWrite: server.canWrite };
		} finally {
			this.registering.delete(key);
		}
	}

	private conflict(
		field: AttemptField,
		localText: string,
		server: ServerFieldState,
		reason: string,
	): FieldRecovery {
		const entry = this.fields.get(fieldKey(field));
		if (entry) {
			entry.canWrite = false;
			entry.status = {
				...entry.status,
				durability: "conflict",
				delivery: "blocked",
				error: reason,
			};
			this.publish(entry);
		}
		return { kind: "conflict", localText, server, reason };
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
			await Promise.all(dirty.map((entry) => this.commit(entry)));
		}
	}

	private async commit(entry: RegisteredField): Promise<void> {
		const version = entry.version;
		const checkpoint = entry.handle.exportCheckpoint();
		const state = parseCheckpoint(checkpoint);
		const savedAt = this.options.now();
		const record: LocalEditRecord = {
			version: 1,
			generation: (entry.generation ?? 0) + 1,
			savedAt,
			expiresAt: savedAt + (this.options.ttlMs ?? LOCAL_EDIT_TTL_MS),
			text: state.text,
			checkpoint,
			outbox: state.inFlight,
		};
		try {
			await this.options.store.commit(
				this.ref(entry.field),
				record,
				entry.generation,
			);
			if (this.revoked) return;
			entry.generation = record.generation;
			entry.status = {
				...entry.status,
				durability: version === entry.version ? "durable" : "pending",
				savedText: record.text,
				error: null,
			};
		} catch (error) {
			if (this.revoked) return;
			try {
				this.options.fallback.write(this.ref(entry.field), {
					version: 1,
					savedAt,
					expiresAt: record.expiresAt,
					text: record.text,
					historyGap: true,
				});
				entry.status = {
					...entry.status,
					durability: version === entry.version ? "text-only" : "pending",
					savedText: record.text,
					historyGap: true,
					error: errorMessage(error),
				};
			} catch (fallbackError) {
				entry.status = {
					...entry.status,
					durability: "unavailable",
					historyGap: true,
					error: errorMessage(fallbackError),
				};
			}
		}
		entry.attemptedVersion = version;
		this.publish(entry);
	}

	private async sendPending(): Promise<void> {
		const pending: { entry: RegisteredField; batch: PendingEditBatch }[] = [];
		for (const entry of this.fields.values()) {
			if (!entry.canWrite || entry.status.durability === "conflict") continue;
			const batch = entry.handle.collect();
			if (batch) {
				/// Retried frozen batches must also have a successful principal commit.
				this.changed(entry);
				pending.push({ entry, batch });
			}
		}
		await this.persist();
		if (this.stopped || this.revoked) return;
		const durable = pending.filter(
			({ entry }) => entry.status.durability === "durable",
		);
		if (durable.length === 0) return;
		for (const { entry } of durable) {
			entry.status = { ...entry.status, delivery: "sending" };
			this.publish(entry);
		}
		try {
			const results = await this.options.transport.send({
				attemptId: this.options.attemptId,
				fields: durable.map(({ entry, batch }) => ({ ...entry.field, batch })),
			});
			if (this.stopped || this.revoked) return;
			for (const { entry } of durable) {
				const matches = results.filter(
					(result) => fieldKey(result) === fieldKey(entry.field),
				);
				const result = matches.length === 1 ? matches[0] : undefined;
				if (result?.kind === "accepted") {
					try {
						entry.handle.acknowledge(result.receipt);
						this.changed(entry);
					} catch (error) {
						entry.status = {
							...entry.status,
							delivery: "pending",
							error: errorMessage(error),
						};
					}
				} else if (result?.kind === "conflict" || result?.kind === "closed") {
					entry.canWrite = false;
					entry.status = {
						...entry.status,
						delivery: "blocked",
						error: result.message ?? result.kind,
						...(result.kind === "conflict"
							? { durability: "conflict" as const }
							: {}),
					};
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
			await this.persist();
		} catch (error) {
			if (this.stopped || this.revoked) return;
			for (const { entry } of durable) {
				entry.status = {
					...entry.status,
					delivery: "pending",
					error: errorMessage(error),
				};
				this.publish(entry);
			}
		}
	}

	private schedulePersistence(): void {
		if (this.stopped || this.revoked || this.cancelPersist || this.persistence)
			return;
		this.cancelPersist = this.options.scheduler.schedule(
			PERSIST_DELAY_MS,
			() => {
				this.cancelPersist = null;
				if (!this.stopped && !this.revoked) void this.persist();
			},
		);
	}

	private scheduleDelivery(): void {
		if (this.stopped || this.revoked || this.cancelDelivery || this.delivery)
			return;
		if (
			![...this.fields.values()].some(
				(entry) => entry.canWrite && entry.handle.getState().hasPendingChanges,
			)
		)
			return;
		this.cancelDelivery = this.options.scheduler.schedule(
			55_000 + this.options.random() * 10_000,
			() => {
				this.cancelDelivery = null;
				if (!this.stopped && !this.revoked) void this.flush();
			},
		);
	}

	private progressKey(): string {
		return JSON.stringify(
			[...this.fields.values()].map((entry) => {
				const state = parseCheckpoint(entry.handle.exportCheckpoint());
				return [state.baseRevision, state.firstSeq];
			}),
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
		if (this.revoked) return;
		try {
			this.options.onStatus?.(Object.freeze({ ...entry.status }));
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
