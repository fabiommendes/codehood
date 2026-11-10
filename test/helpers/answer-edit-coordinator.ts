import {
	AnswerEditCoordinator,
	type AttemptTransport,
	type CoordinatorOptions,
	type CoordinatorScheduler,
	type FieldResult,
	type FieldStatus,
	type ServerFieldState,
} from "@/services/answer-edits/coordinator";
import { AnswerEditMonitor } from "@/services/answer-edits/monitor";
import type {
	EditStore,
	FieldRef,
	LocalEditRecord,
	TextRecovery,
	TextRecoveryStore,
} from "@/services/answer-edits/storage";

export const FIELD = { questionId: "question", field: "answer" };
export const REF = { attemptId: "attempt", ...FIELD };
export const EPOCH = 1_800_000_000_000;

export function deferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

/// Flush promise continuations without advancing either injected clock.
export async function drain() {
	for (let turn = 0; turn < 80; turn++) await Promise.resolve();
}

export class ManualScheduler implements CoordinatorScheduler {
	private elapsed = 0;
	private nextId = 0;
	private readonly tasks = new Map<
		number,
		{ at: number; callback: () => void }
	>();
	schedule(delayMs: number, callback: () => void) {
		if (!Number.isFinite(delayMs) || delayMs < 0)
			throw new Error("Invalid delay");
		const id = ++this.nextId;
		this.tasks.set(id, { at: this.elapsed + delayMs, callback });
		return () => {
			this.tasks.delete(id);
		};
	}
	async advance(ms: number) {
		const end = this.elapsed + ms;
		for (let count = 0; count < 10_000; count++) {
			const next = [...this.tasks.entries()].sort(
				(a, b) => a[1].at - b[1].at,
			)[0];
			if (!next || next[1].at > end) {
				this.elapsed = end;
				await drain();
				return;
			}
			this.elapsed = next[1].at;
			this.tasks.delete(next[0]);
			next[1].callback();
			await drain();
		}
		throw new Error("Scheduler did not quiesce");
	}
	get elapsedMs() {
		return this.elapsed;
	}
	get pendingCount() {
		return this.tasks.size;
	}
}

const key = (ref: FieldRef) =>
	JSON.stringify([ref.attemptId, ref.questionId, ref.field]);

/// Atomic CAS writes check revocation when a held transaction actually completes.
export class MemoryEditStore implements EditStore {
	private readonly records = new Map<string, LocalEditRecord>();
	private nextGate: ReturnType<typeof deferred<void>> | null = null;
	readonly commits: {
		ref: FieldRef;
		record: LocalEditRecord;
		expected: number | null;
	}[] = [];
	failRead = false;
	failCommit = false;
	revoked = false;
	holdNextCommit() {
		const gate = deferred<void>();
		this.nextGate = gate;
		return gate;
	}
	async read(ref: FieldRef, now: number) {
		if (this.failRead) throw new Error("IndexedDB unavailable");
		const record = this.records.get(key(ref));
		return this.revoked || !record || record.expiresAt <= now
			? null
			: structuredClone(record);
	}
	async commit(
		ref: FieldRef,
		record: LocalEditRecord,
		expected: number | null,
	) {
		const candidate = structuredClone(record);
		this.commits.push({
			ref: structuredClone(ref),
			record: candidate,
			expected,
		});
		const gate = this.nextGate;
		this.nextGate = null;
		if (gate) await gate.promise;
		if (this.revoked || this.failCommit) throw new Error("Transaction aborted");
		const previous = this.records.get(key(ref));
		if (
			(previous?.generation ?? null) !== expected ||
			candidate.generation <= (previous?.generation ?? 0)
		)
			throw new Error("Stale generation");
		this.records.set(key(ref), candidate);
	}
	async remove(ref: FieldRef) {
		this.records.delete(key(ref));
	}
	async revoke() {
		this.revoked = true;
		this.records.clear();
	}
}

export class MemoryTextStore implements TextRecoveryStore {
	private readonly records = new Map<string, TextRecovery>();
	failWrite = false;
	revoked = false;
	read(ref: FieldRef, now: number) {
		const record = this.records.get(key(ref));
		return this.revoked || !record || record.expiresAt <= now
			? null
			: structuredClone(record);
	}
	write(ref: FieldRef, recovery: TextRecovery) {
		if (this.revoked || this.failWrite)
			throw new Error("Text storage unavailable");
		this.records.set(key(ref), structuredClone(recovery));
	}
	remove(ref: FieldRef) {
		this.records.delete(key(ref));
	}
	revoke() {
		this.revoked = true;
		this.records.clear();
	}
}

export class LocalTransport implements AttemptTransport {
	readonly inspections: FieldRef[] = [];
	readonly requests: Parameters<AttemptTransport["send"]>[0][] = [];
	server: ServerFieldState = {
		text: "",
		revision: 0,
		nextSeq: 1,
		canWrite: true,
		receipts: [],
	};
	inspectionGate: ReturnType<typeof deferred<ServerFieldState>> | null = null;
	sendGate: ReturnType<typeof deferred<readonly FieldResult[]>> | null = null;
	async inspect(ref: FieldRef) {
		this.inspections.push(structuredClone(ref));
		return this.inspectionGate
			? this.inspectionGate.promise
			: structuredClone(this.server);
	}
	async send(request: Parameters<AttemptTransport["send"]>[0]) {
		this.requests.push(structuredClone(request));
		return this.sendGate
			? this.sendGate.promise
			: request.fields.map(({ questionId, field }) => ({
					questionId,
					field,
					kind: "retry" as const,
				}));
	}
}

export function rig(
	overrides: Partial<
		Omit<CoordinatorOptions, "store" | "fallback" | "transport" | "scheduler">
	> & { scheduler?: ManualScheduler } = {},
) {
	const store = new MemoryEditStore();
	const fallback = new MemoryTextStore();
	const scheduler = overrides.scheduler ?? new ManualScheduler();
	const transport = new LocalTransport();
	const statuses: Readonly<FieldStatus>[] = [];
	let monotonic = 10_000;
	let session = 0;
	const options = {
		ownerId: "owner",
		attemptId: REF.attemptId,
		store,
		fallback,
		scheduler,
		transport,
		now: () => EPOCH,
		monotonicNow: () => monotonic,
		random: () => 0.5,
		createSessionId: () => `restored-${++session}`,
		onStatus: (status: Readonly<FieldStatus>) => {
			statuses.push(structuredClone(status));
		},
		...overrides,
	};
	const coordinator = new AnswerEditCoordinator(options);
	const monitor = new AnswerEditMonitor({
		initialText: "",
		sessionId: "editor-session",
		baseRevision: 0,
		firstSeq: 1,
		now: () => monotonic,
	});
	return {
		coordinator,
		monitor,
		store,
		fallback,
		scheduler,
		transport,
		statuses,
		options,
		append(text: string, interval = 100) {
			monotonic += interval;
			const input = monitor.observeInput({ atMs: monotonic, kind: "typing" });
			monitor.recordChange({
				atMs: monotonic,
				input,
				kind: "typing",
				replacements: [
					{
						position: monitor.getState().text.length,
						deleteCount: 0,
						insertedText: text,
					},
				],
			});
		},
		clear() {
			monotonic += 100;
			monitor.recordChange({
				atMs: monotonic,
				kind: "delete",
				replacements: [
					{
						position: 0,
						deleteCount: monitor.getState().text.length,
						insertedText: "",
					},
				],
			});
		},
	};
}

export function restoreRecord(record: LocalEditRecord) {
	return AnswerEditMonitor.restore({
		checkpoint: record.checkpoint,
		now: () => 0,
		createSessionId: () => "reader-session",
	});
}
