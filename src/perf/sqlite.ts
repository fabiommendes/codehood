/**
 * Times every SQL statement at the SQLite adapter, where `$queryRaw`, the
 * queries Prisma generates and `COMMIT` all pass.
 *
 * better-sqlite3 is synchronous: the time measured here is time the event
 * loop was held.
 */
import { logEvent } from "@/utils/log";
import { PERF } from "./config";
import { currentOp, currentRequest, lastSeen, round, totals } from "./state";

/// Folds away what makes two runs of one statement differ and what hides its
/// `WHERE`: the length of a parameter list (`?,?,?`) and a long column list.
const normalise = (sql: string) =>
	sql
		.replace(/\?(?:\s*,\s*\?)+/g, "?…")
		.replace(/^SELECT .{200,}? FROM /, "SELECT … FROM ");

/// Longest SQL text a line carries.
const MAX_SQL = 600;

/** Adds one statement that took `ms` to the request and to the interval. */
export function recordQuery(sql: string, ms: number): void {
	totals.queries++;
	totals.dbMs += ms;
	if (ms > totals.slowestQueryMs) totals.slowestQueryMs = ms;
	if (sql === "COMMIT")
		totals.commits.record(Math.max(1, Math.round(ms * 1000)));

	const perf = currentRequest();
	if (perf) {
		perf.queries++;
		perf.dbMs += ms;
		lastSeen.request = perf;
	}
	if (ms >= PERF.slowQueryMs)
		logEvent("slow-query", {
			ms: round(ms),
			sql: normalise(sql).slice(0, MAX_SQL),
			op: currentOp(),
			id: perf?.id,
			route: perf?.route,
		});
}

type Method = (this: unknown, ...args: never[]) => unknown;

/// Prototypes already wrapped: every adapter and transaction shares one.
const wrapped = new WeakSet<object>();

/// The synchronous methods every statement runs through: reads, then writes and `COMMIT`.
const STATEMENT_METHODS = ["performIO", "executeIO"] as const;

/// Wraps the statement methods of the prototype adapters and transactions share.
function timeStatements(adapter: object): boolean {
	let proto = Object.getPrototypeOf(adapter);
	while (
		proto &&
		!STATEMENT_METHODS.every((name) => Object.hasOwn(proto, name))
	)
		proto = Object.getPrototypeOf(proto);
	if (!proto) return false;
	if (wrapped.has(proto)) return true;
	wrapped.add(proto);

	for (const name of STATEMENT_METHODS) {
		const original = proto[name] as Method;
		proto[name] = function (this: unknown, query: { sql: string }) {
			if (!PERF.enabled) return original.call(this, query as never);
			const start = performance.now();
			try {
				return original.call(this, query as never);
			} finally {
				recordQuery(query.sql, performance.now() - start);
			}
		};
	}
	return true;
}

/// Measures the wait for the mutex the adapter runs every transaction under.
function timeTransactionWait(adapter: { startTransaction?: Method }): void {
	const start = adapter.startTransaction?.bind(adapter) as
		| ((...args: unknown[]) => Promise<unknown>)
		| undefined;
	if (!start) return;
	adapter.startTransaction = (async (...args: unknown[]) => {
		if (!PERF.enabled) return start(...args);
		const asked = performance.now();
		totals.txWaiting++;
		try {
			return await start(...args);
		} finally {
			totals.txWaiting--;
			const wait = performance.now() - asked;
			if (wait > totals.txWaitMaxMs) totals.txWaitMaxMs = wait;
			const perf = currentRequest();
			if (perf) perf.txWaitMs += wait;
		}
	}) as Method;
}

/**
 * Makes the adapters `factory` connects report their statements to the
 * performance log, and returns `factory`.
 *
 * An adapter whose internals changed is left alone, with one line in the log.
 */
export function instrumentAdapter<F extends { connect: () => Promise<object> }>(
	factory: F,
): F {
	const connect = factory.connect.bind(factory);
	factory.connect = async () => {
		const adapter = await connect();
		if (timeStatements(adapter)) timeTransactionWait(adapter);
		else logEvent("perf.unavailable", { what: "sqlite adapter" });
		return adapter;
	};
	return factory;
}
