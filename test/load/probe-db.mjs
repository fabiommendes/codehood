/**
 * Preloaded into the server under load (`node --import`), next to `probe.mjs`.
 * It wraps the HTTP server and the SQLite adapter the server creates; both
 * come from Node and `node_modules`, the same modules this file patches, so
 * the server's code is untouched. Each file is optional:
 *
 * `LOAD_TX_FILE`: one JSON line per transaction. `@prisma/adapter-better-sqlite3`
 * runs every transaction under one mutex, and every service operation opens
 * one (`inTx` in `src/db/define-service.ts`).
 * - `t`: when it asked for the mutex (epoch ms);
 * - `wait`: ms until it got the mutex and ran `BEGIN`;
 * - `hold`: ms from `BEGIN` to the commit or rollback;
 * - `queued`: transactions already waiting when it asked;
 * - `ok`: false when it rolled back.
 *
 * `LOAD_SQL_FILE`: the time better-sqlite3 spent, per second, as JSON lines
 * `{t, route, caller, sql, op, n, ms, max}`. These calls are synchronous: their
 * time is time the event loop was blocked.
 * - `route`: the request that ran it (see below);
 * - `caller`: the server's own functions on the (async) stack that led to the
 *   query, innermost first, as `name@file:line` inside `dist/server`. Prisma
 *   batches queries and runs them away from their caller's stack, so the
 *   stack is taken when the server calls the client (`_request` of
 *   `@prisma/client/runtime/client`, rewritten as it loads) and carried to
 *   the query in an `AsyncLocalStorage`;
 * - `op`: `prepare` (the adapter prepares every query again) or the method
 *   that ran it (`all`, `get`, `run`, `iterate`).
 *
 * `LOAD_ROUTE_FILE`: per second and per route, JSON lines `{t, route, n, cpu,
 * wall}`: requests finished, ms of synchronous JavaScript run on their behalf
 * (every slice of the event loop under the request's async context, via
 * `async_hooks`), and the sum of their ms from arrival to the response's end.
 *
 * A route is `action <name>` for `/_actions/<name>`, otherwise the method and
 * the path with the load test's own names folded (`load001` → `load*`).
 */

import { AsyncLocalStorage, createHook } from "node:async_hooks";
import { appendFileSync, readFileSync } from "node:fs";
import http from "node:http";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const txFile = process.env.LOAD_TX_FILE;
const sqlFile = process.env.LOAD_SQL_FILE;
const routeFile = process.env.LOAD_ROUTE_FILE;

const round = (ms) => Math.round(ms * 100) / 100;

let txLines = [];
let txWaiting = 0;
/// `${route}\0${caller}\0${op}\0${sql}` → time in the current second.
let sqlTimes = new Map();
/// route → { n, cpu, wall } in the current second.
let routeTimes = new Map();

const flush = () => {
	const t = Date.now();
	if (txFile && txLines.length) {
		appendFileSync(txFile, txLines.join(""));
		txLines = [];
	}
	if (sqlFile && sqlTimes.size) {
		let out = "";
		for (const [key, v] of sqlTimes) {
			const [route, caller, op, sql] = key.split("\0");
			out += `${JSON.stringify({ t, route, caller, sql, op, n: v.n, ms: round(v.ms), max: round(v.max) })}\n`;
		}
		appendFileSync(sqlFile, out);
		sqlTimes = new Map();
	}
	if (routeFile && routeTimes.size) {
		let out = "";
		for (const [route, v] of routeTimes)
			out += `${JSON.stringify({ t, route, n: v.n, cpu: round(v.cpu), wall: round(v.wall) })}\n`;
		appendFileSync(routeFile, out);
		routeTimes = new Map();
	}
};

if (txFile || sqlFile || routeFile) {
	setInterval(flush, 1000).unref();
	process.on("exit", flush);
}

// --- Requests ---------------------------------------------------------------

/// The request a piece of work belongs to: `{ route }`.
const requests = new AsyncLocalStorage();

const routeOf = (req) => {
	const url = (req.url ?? "").split("?")[0];
	const action = url.match(/^\/_actions\/([^/]+)/);
	if (action) return `action ${action[1]}`;
	return `${req.method} ${url.replace(/load\d+/g, "load*")}`;
};

const routeEntry = (route) => {
	let v = routeTimes.get(route);
	if (!v) {
		v = { n: 0, cpu: 0, wall: 0 };
		routeTimes.set(route, v);
	}
	return v;
};

if (sqlFile || routeFile) {
	const emit = http.Server.prototype.emit;
	http.Server.prototype.emit = function (event, req, res, ...rest) {
		if (event !== "request") return emit.call(this, event, req, res, ...rest);
		const context = { route: routeOf(req) };
		const arrived = performance.now();
		res.once("close", () => {
			const v = routeEntry(context.route);
			v.n++;
			v.wall += performance.now() - arrived;
		});
		const start = performance.now();
		try {
			return requests.run(context, () =>
				emit.call(this, event, req, res, ...rest),
			);
		} finally {
			// The synchronous start of the request runs in a slice that belongs to no request.
			routeEntry(context.route).cpu += performance.now() - start;
		}
	};
}

if (routeFile) {
	// Each callback the event loop runs (a timer, I/O, a promise reaction) is
	// one slice between `before` and `after`; credit the outermost to its request.
	let depth = 0;
	let start = 0;
	createHook({
		before() {
			if (depth++ === 0) start = performance.now();
		},
		after() {
			if (--depth !== 0) return;
			const context = requests.getStore();
			if (context) routeEntry(context.route).cpu += performance.now() - start;
		},
	}).enable();
}

// --- SQLite ------------------------------------------------------------------

/// Prisma spells a list of parameters as `?,?,?`: fold its length away.
const normalise = (sql) => sql.replace(/\?(?:\s*,\s*\?)+/g, "?…");

/// The server's frames on the current (async) stack, innermost first.
const callerOf = () => {
	const limit = Error.stackTraceLimit;
	Error.stackTraceLimit = 80;
	const stack = new Error().stack ?? "";
	Error.stackTraceLimit = limit;
	const frames = [];
	for (const line of stack.split("\n")) {
		const m = line.match(
			/at (?:async )?(?:(.+?) \()?file:\/\/.*\/dist\/server\/(.+?):(\d+):\d+\)?$/,
		);
		if (!m) continue;
		const frame = `${m[1] ?? "(anonymous)"}@${m[2]}:${m[3]}`;
		if (frames.at(-1) !== frame) frames.push(frame);
		if (frames.length === 8) break;
	}
	return frames.join(" < ");
};

const record = (op, sql, ms, caller) => {
	const route = requests.getStore()?.route ?? "(no request)";
	const key = `${route}\0${caller}\0${op}\0${normalise(sql)}`;
	const v = sqlTimes.get(key);
	if (v) {
		v.n++;
		v.ms += ms;
		if (ms > v.max) v.max = ms;
	} else sqlTimes.set(key, { n: 1, ms, max: ms });
};

/// The caller of the statement being run: set by `prepare`, which the adapter calls right before.
const callers = new WeakMap();

let statementPatched = false;
/// Times the methods of better-sqlite3's (native) Statement, shared by every statement.
const patchStatement = (statement) => {
	if (statementPatched) return;
	statementPatched = true;
	const proto = Object.getPrototypeOf(statement);
	for (const op of ["all", "get", "run", "iterate"]) {
		const original = proto[op];
		if (typeof original !== "function") continue;
		proto[op] = function (...args) {
			const start = performance.now();
			try {
				return original.apply(this, args);
			} finally {
				record(
					op,
					this.source,
					performance.now() - start,
					callers.get(this) ?? "",
				);
			}
		};
	}
};

/// The caller of the Prisma call being run, from `_request`.
const prismaCallers = new AsyncLocalStorage();

if (sqlFile) {
	globalThis.__loadPrismaRequest = (run) => prismaCallers.run(callerOf(), run);
	const marker = "_request(n){n.otelParentCtx=";
	registerHooks({
		load(url, context, nextLoad) {
			const result = nextLoad(url, context);
			// Node's own condition picks the CommonJS build (`client.js`).
			if (!/\/@prisma\/client\/runtime\/client\.m?js$/.test(url)) return result;
			const source = String(result.source ?? readFileSync(fileURLToPath(url)));
			if (!source.includes(marker)) {
				console.warn(
					"probe-db: _request not found in the Prisma runtime; queries keep the stack of prepare",
				);
				return result;
			}
			return {
				...result,
				source: source.replace(
					marker,
					"_request(n){return globalThis.__loadPrismaRequest(()=>this.__loadRequest(n))}__loadRequest(n){n.otelParentCtx=",
				),
			};
		},
	});
}

const watchQueries = (client) => {
	const prepare = client.prepare.bind(client);
	client.prepare = (sql) => {
		const caller = prismaCallers.getStore() || callerOf();
		const start = performance.now();
		const statement = prepare(sql);
		record("prepare", sql, performance.now() - start, caller);
		callers.set(statement, caller);
		patchStatement(statement);
		return statement;
	};
};

// --- Transactions ------------------------------------------------------------

const watchTransactions = (adapter) => {
	const start = adapter.startTransaction.bind(adapter);
	adapter.startTransaction = async (...args) => {
		const t = Date.now();
		const asked = performance.now();
		const queued = txWaiting++;
		let tx;
		try {
			tx = await start(...args);
		} finally {
			txWaiting--;
		}
		const begun = performance.now();
		const end = (ok) => {
			txLines.push(
				`${JSON.stringify({ t, wait: round(begun - asked), hold: round(performance.now() - begun), queued, ok })}\n`,
			);
		};
		const commit = tx.commit.bind(tx);
		const rollback = tx.rollback.bind(tx);
		tx.commit = () => {
			end(true);
			return commit();
		};
		tx.rollback = () => {
			end(false);
			return rollback();
		};
		return tx;
	};
};

if (txFile || sqlFile) {
	const connect = PrismaBetterSqlite3.prototype.connect;
	PrismaBetterSqlite3.prototype.connect = async function (...args) {
		const adapter = await connect.apply(this, args);
		if (txFile) watchTransactions(adapter);
		if (sqlFile) watchQueries(adapter.client);
		return adapter;
	};
}
