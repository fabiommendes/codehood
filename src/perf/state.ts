/**
 * What the performance log knows while the server runs: the request each
 * piece of work belongs to, and the totals since the last periodic line.
 *
 * Nothing here writes to the log or reads the database.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHistogram } from "node:perf_hooks";

/// The measurements of one request, filled in as it runs.
export interface RequestPerf {
	id: string;
	route: string;
	/// SQL statements run, and the ms SQLite took to run them.
	queries: number;
	dbMs: number;
	/// ms spent waiting for the adapter's transaction mutex.
	txWaitMs: number;
	/// Service calls made from outside a service.
	services: number;
	/// The slowest of those calls.
	slowest: string | null;
	slowestMs: number;
	/// The first JSON-RPC method dispatched, and how many were.
	rpc: string | null;
	rpcCalls: number;
}

const requests = new AsyncLocalStorage<RequestPerf>();

/** The request the current piece of work belongs to, if any. */
export function currentRequest(): RequestPerf | undefined {
	return requests.getStore();
}

/** Runs `fn` as part of a new request, and returns its measurements with the result. */
export function runAsRequest<R>(
	id: string,
	route: string,
	fn: (perf: RequestPerf) => R,
): R {
	const perf: RequestPerf = {
		id,
		route,
		queries: 0,
		dbMs: 0,
		txWaitMs: 0,
		services: 0,
		slowest: null,
		slowestMs: 0,
		rpc: null,
		rpcCalls: 0,
	};
	lastSeen.request = perf;
	lastSeen.op = null;
	return requests.run(perf, () => fn(perf));
}

const ops = new AsyncLocalStorage<string>();

/** The service call the current piece of work belongs to, the innermost when nested. */
export function currentOp(): string | null {
	return ops.getStore() ?? null;
}

/** Runs `fn` as part of the service call `op`. */
export function runAsOp<Args extends unknown[], R>(
	op: string,
	fn: (...args: Args) => R,
	...args: Args
): R {
	return ops.run(op, fn, ...args);
}

/** Records, on the current request, that a JSON-RPC method was dispatched. */
export function noteRpcMethod(method: string): void {
	const perf = requests.getStore();
	if (!perf) return;
	perf.rpc ??= method;
	perf.rpcCalls++;
}

/// Totals since the last periodic line; `inFlight` and `txWaiting` are current.
export const totals = {
	inFlight: 0,
	requests: 0,
	errors: 0,
	queries: 0,
	dbMs: 0,
	slowestQueryMs: 0,
	txWaiting: 0,
	txWaitMaxMs: 0,
	/// Duration of each `COMMIT`, in µs: the cost of the disk's `fsync`.
	commits: createHistogram(),
};

/// The last request and service call seen at work, to name in a stall.
export const lastSeen: { request: RequestPerf | undefined; op: string | null } =
	{ request: undefined, op: null };

/** Zeroes the totals of the interval. */
export function resetTotals(): void {
	totals.requests = 0;
	totals.errors = 0;
	totals.queries = 0;
	totals.dbMs = 0;
	totals.slowestQueryMs = 0;
	totals.txWaitMaxMs = 0;
	totals.commits.reset();
}

/** Rounds a duration to a tenth of a millisecond. */
export function round(ms: number): number {
	return Math.round(ms * 10) / 10;
}
