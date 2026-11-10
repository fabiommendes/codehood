import { parseCheckpoint } from "./checkpoint";
import type { MonitorCheckpoint, PendingEditBatch } from "./monitor";

export interface FieldRef {
	readonly attemptId: string;
	readonly questionId: string;
	readonly field: string;
}

export interface LocalEditRecord {
	readonly version: 1;
	readonly generation: number;
	readonly savedAt: number;
	readonly expiresAt: number;
	readonly text: string;
	readonly checkpoint: MonitorCheckpoint;
	readonly outbox: PendingEditBatch | null;
}

export interface TextRecovery {
	readonly version: 1;
	readonly savedAt: number;
	readonly expiresAt: number;
	readonly text: string;
	readonly historyGap: true;
}

/** A session-scoped store rejects stale CAS writes and all writes after revocation. */
export interface EditStore {
	read(ref: FieldRef, now: number): Promise<LocalEditRecord | null>;
	commit(
		ref: FieldRef,
		record: LocalEditRecord,
		expectedGeneration: number | null,
	): Promise<void>;
	remove(ref: FieldRef): Promise<void>;
	revoke(): Promise<void>;
}

export interface TextRecoveryStore {
	read(ref: FieldRef, now: number): TextRecovery | null;
	write(ref: FieldRef, recovery: TextRecovery): void;
	remove(ref: FieldRef): void;
	revoke(): void;
}

export const LOCAL_EDIT_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_LOCAL_RECORD_BYTES = 2 * 1024 * 1024;

/// Field keys are JSON arrays, so this metadata key cannot collide with a field.
const REVOCATION_KEY = "revocation-token";
interface SessionFence {
	readonly token: unknown;
	invalidate(): void;
}
const sessionFences = new WeakMap<IDBFactory, Map<string, Set<SessionFence>>>();

/** Open only this owner's IndexedDB namespace, with injectable browser APIs. */
export function openIndexedDbEditStore(options: {
	ownerId: string;
	indexedDB: IDBFactory;
	databasePrefix?: string;
}): Promise<EditStore> {
	const name = namespace(
		options.databasePrefix ?? "codehood-answer-edits",
		options.ownerId,
	);
	return new Promise((resolve, reject) => {
		const request = options.indexedDB.open(name, 1);
		request.onupgradeneeded = () => {
			request.result.createObjectStore("records");
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => {
			const database = request.result;
			const transaction = database.transaction("records", "readonly");
			const tokenRequest = transaction
				.objectStore("records")
				.get(REVOCATION_KEY);
			transaction.onabort = () => {
				database.close();
				reject(transaction.error ?? new Error("Cannot read revocation token"));
			};
			transaction.oncomplete = () =>
				resolve(
					indexedDbHandle(database, {
						token: tokenRequest.result,
						peers: namespaceFences(options.indexedDB, name),
					}),
				);
		};
	});
}

/** Keep only bounded text and gap metadata when durable history is unavailable. */
export function createTextRecoveryStore(options: {
	ownerId: string;
	storage: Storage;
	keyPrefix?: string;
}): TextRecoveryStore {
	const key = namespace(
		options.keyPrefix ?? "codehood-answer-text",
		options.ownerId,
	);
	const { storage } = options;
	const tokenKey = JSON.stringify([key, REVOCATION_KEY]);
	const indexKey = JSON.stringify([key, "revoked-generations", 1]);
	const token = storage.getItem(tokenKey);
	/// Three-part metadata keys cannot collide with data keys or the token slot.
	const revocationKey = (generation: string | null): string =>
		JSON.stringify([key, "revoked-generation", generation]);
	const isRevoked = (generation: string | null): boolean =>
		storage.getItem(revocationKey(generation)) === "1";
	/// Before the first revocation, keep reading the original pre-token records.
	const generationKey = (generation: string | null): string =>
		generation === null ? key : JSON.stringify([key, generation]);
	const dataKey = generationKey(token);
	let revoked = false;
	const revokedGenerations = (): Set<string | null> => {
		const json = storage.getItem(indexKey);
		const generations: unknown = json === null ? [] : JSON.parse(json);
		if (
			!Array.isArray(generations) ||
			generations.some(
				(generation) =>
					generation !== null &&
					(typeof generation !== "string" || generation === REVOCATION_KEY),
			)
		)
			throw new TypeError("Invalid text recovery revocation index");
		return new Set(generations);
	};
	const reconcile = (): void => {
		const generations = revokedGenerations();
		/// The original handle can repair erasure even if its index entry was lost.
		generations.add(token);
		for (const generation of generations) {
			/// The index is only a hint; individual proofs authorize physical erasure.
			if (generation !== REVOCATION_KEY && isRevoked(generation))
				storage.removeItem(generationKey(generation));
		}
	};
	const requireActive = (): void => {
		reconcile();
		if (revoked || isRevoked(token) || storage.getItem(tokenKey) !== token) {
			revoked = true;
			throw new Error("Text recovery store is revoked");
		}
	};
	const save = (records: Record<string, TextRecovery>): void => {
		requireActive();
		storage.setItem(dataKey, JSON.stringify(records));
		/// Storage cannot fence a suspended writer atomically. Compensate when it
		/// resumes; reconciliation retries erasure if storage is temporarily failing.
		if (revoked || isRevoked(token) || storage.getItem(tokenKey) !== token) {
			revoked = true;
			/// A delayed rotation can invalidate an unrevoked generation logically;
			/// only its persistent revocation proof permits physical erasure.
			if (isRevoked(token)) storage.removeItem(dataKey);
			throw new Error("Text recovery store is revoked");
		}
	};
	const entries = (): Record<string, TextRecovery> => {
		const json = storage.getItem(dataKey);
		return json === null
			? {}
			: (object(JSON.parse(json)) as Record<string, TextRecovery>);
	};
	reconcile();
	return {
		read(ref, now) {
			requireActive();
			requireFinite(now, "now");
			const id = fieldKey(ref);
			const records = entries();
			requireActive();
			if (!Object.hasOwn(records, id)) return null;
			const recovery = textRecovery(records[id]);
			if (recovery.expiresAt <= now) {
				delete records[id];
				save(records);
				return null;
			}
			return recovery;
		},
		write(ref, recovery) {
			requireActive();
			const id = fieldKey(ref);
			const record = textRecovery(recovery);
			const records = entries();
			records[id] = record;
			save(records);
		},
		remove(ref) {
			requireActive();
			const id = fieldKey(ref);
			const records = entries();
			delete records[id];
			save(records);
		},
		revoke() {
			revoked = true;
			/// Keep this text-free proof after cleanup: a suspended writer may return.
			/// Repeated calls must mark the original generation even after rotation.
			storage.setItem(revocationKey(token), "1");
			/// Concurrent read-modify-writes can lose index entries, but never proofs.
			/// Repeating revocation repairs this generation's discovery hint.
			const generations = revokedGenerations();
			generations.add(token);
			storage.setItem(indexKey, JSON.stringify([...generations]));
			if (storage.getItem(tokenKey) === token) {
				/// Retain the token after erasure so old handles stay fenced across pages.
				/// Without CAS, a suspended rotation can still replace a newer token.
				storage.setItem(tokenKey, crypto.randomUUID());
			}
			/// Always retry cleanup, even if an earlier revocation failed or a newer
			/// session already rotated the token.
			reconcile();
		},
	};
}

function indexedDbHandle(
	database: IDBDatabase,
	session: { token: unknown; peers: Set<SessionFence> },
): EditStore {
	let revoked = false;
	let revocation: Promise<void> | undefined;
	const pending = new Set<IDBTransaction>();
	const fence: SessionFence = {
		token: session.token,
		invalidate() {
			revoked = true;
			session.peers.delete(fence);
			for (const transaction of pending) transaction.abort();
		},
	};
	session.peers.add(fence);
	const requireActive = (): void => {
		if (revoked) throw new Error("Edit store is revoked");
	};
	const run = <T>(
		key: string | null,
		action: (current: unknown, store: IDBObjectStore) => T,
		clearing = false,
	): Promise<T> => {
		return new Promise((resolve, reject) => {
			if (!clearing) requireActive();
			const transaction = database.transaction("records", "readwrite");
			pending.add(transaction);
			let result: T;
			let failure: unknown;
			transaction.oncomplete = () => {
				pending.delete(transaction);
				if (revoked && !clearing) reject(new Error("Edit store is revoked"));
				else resolve(result);
			};
			transaction.onabort = () => {
				pending.delete(transaction);
				reject(
					failure ?? transaction.error ?? new Error("Edit transaction aborted"),
				);
			};
			const store = transaction.objectStore("records");
			const apply = (current: unknown): void => {
				try {
					if (!clearing) requireActive();
					result = action(current, store);
				} catch (error) {
					failure = error;
					transaction.abort();
				}
			};
			/// The fence check and the record mutation share one serial transaction.
			const tokenRequest = store.get(REVOCATION_KEY);
			tokenRequest.onsuccess = () => {
				if (tokenRequest.result !== session.token) {
					if (clearing) return;
					failure = new Error("Edit store is revoked");
					transaction.abort();
					return;
				}
				if (key === null) apply(undefined);
				else {
					const request = store.get(key);
					request.onsuccess = () => apply(request.result);
				}
			};
		});
	};
	return {
		async read(ref, now) {
			requireActive();
			requireFinite(now, "now");
			const key = fieldKey(ref);
			return run(key, (current, store) => {
				if (current === undefined) return null;
				const record = localRecord(current);
				if (record.expiresAt <= now) {
					store.delete(key);
					return null;
				}
				return record;
			});
		},
		async commit(ref, record, expectedGeneration) {
			requireActive();
			const key = fieldKey(ref);
			if (expectedGeneration !== null) requireGeneration(expectedGeneration);
			const next = localRecord(record);
			if (next.generation !== (expectedGeneration ?? 0) + 1)
				throw new TypeError(
					"Record must advance the expected generation by one",
				);
			return run(key, (current, store) => {
				const generation =
					current === undefined ? null : localRecord(current).generation;
				if (generation !== expectedGeneration)
					throw new Error("Stale edit store generation");
				store.put(next, key);
			});
		},
		async remove(ref) {
			requireActive();
			const key = fieldKey(ref);
			return run(key, (_current, store) => {
				store.delete(key);
			});
		},
		revoke() {
			if (revocation) return revocation;
			for (const peer of session.peers) {
				if (peer.token === session.token) peer.invalidate();
			}
			revoked = true;
			revocation = run(
				null,
				(_current, store) => {
					store.clear();
					store.put(crypto.randomUUID(), REVOCATION_KEY);
				},
				true,
			).finally(() => database.close());
			return revocation;
		},
	};
}

function namespaceFences(factory: IDBFactory, name: string): Set<SessionFence> {
	let namespaces = sessionFences.get(factory);
	if (!namespaces) {
		namespaces = new Map();
		sessionFences.set(factory, namespaces);
	}
	let peers = namespaces.get(name);
	if (!peers) {
		peers = new Set();
		namespaces.set(name, peers);
	}
	return peers;
}

function namespace(prefix: string, ownerId: string): string {
	requireId(ownerId);
	return JSON.stringify([prefix, ownerId]);
}

function fieldKey(ref: FieldRef): string {
	object(ref);
	const fields = [ref.attemptId, ref.questionId, ref.field];
	for (const field of fields) requireId(field);
	return JSON.stringify(fields);
}

function requireId(value: unknown): asserts value is string {
	if (typeof value !== "string" || value.length === 0)
		throw new TypeError("Owner and field identifiers must be nonempty strings");
}

function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		throw new TypeError("Expected a record");
	return value as Record<string, unknown>;
}

function requireFinite(value: unknown, name: string): asserts value is number {
	if (typeof value !== "number" || !Number.isFinite(value))
		throw new TypeError(`${name} must be finite`);
}

function requireGeneration(value: unknown): asserts value is number {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
		throw new TypeError("Generation must be a positive safe integer");
}

function metadata(value: Record<string, unknown>): {
	version: 1;
	savedAt: number;
	expiresAt: number;
	text: string;
} {
	if (value.version !== 1 || typeof value.text !== "string")
		throw new TypeError("Invalid local record version or text");
	requireFinite(value.savedAt, "savedAt");
	requireFinite(value.expiresAt, "expiresAt");
	if (value.expiresAt <= value.savedAt)
		throw new TypeError("expiresAt must follow savedAt");
	return {
		version: 1,
		savedAt: value.savedAt,
		expiresAt: value.expiresAt,
		text: value.text,
	};
}

function bounded<T>(record: T): T {
	if (
		new TextEncoder().encode(JSON.stringify(record)).byteLength >
		MAX_LOCAL_RECORD_BYTES
	)
		throw new RangeError("Local record exceeds the byte limit");
	return record;
}

function textRecovery(value: unknown): TextRecovery {
	const data = object(value);
	if (data.historyGap !== true)
		throw new TypeError("Text recovery must mark a history gap");
	return bounded({ ...metadata(data), historyGap: true });
}

function localRecord(value: unknown): LocalEditRecord {
	const data = object(value);
	const base = metadata(data);
	requireGeneration(data.generation);
	const state = parseCheckpoint(data.checkpoint);
	if (state.text !== base.text)
		throw new TypeError("Checkpoint text differs from record text");
	if (!equalJson(data.outbox, state.inFlight))
		throw new TypeError("Outbox differs from checkpoint in-flight batch");
	return bounded({
		...base,
		generation: data.generation,
		checkpoint: { version: 2, state },
		outbox: state.inFlight,
	});
}

function equalJson(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (
		left === null ||
		right === null ||
		typeof left !== "object" ||
		typeof right !== "object"
	)
		return false;
	if (Array.isArray(left) !== Array.isArray(right)) return false;
	const a = left as Record<string, unknown>;
	const b = right as Record<string, unknown>;
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every((key) => Object.hasOwn(b, key) && equalJson(a[key], b[key]))
	);
}
