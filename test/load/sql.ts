/**
 * Summarises what `probe-db.mjs` wrote: the time better-sqlite3 spent per SQL
 * text (`LOAD_SQL_FILE`), and the CPU and time each route took
 * (`LOAD_ROUTE_FILE`). The SQL time is credited to the server's methods that
 * ran the query, read from the build in `dist`.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

interface SqlLine {
	t: number;
	route: string;
	caller: string;
	sql: string;
	op: string;
	n: number;
	ms: number;
	max: number;
}

interface RouteLine {
	t: number;
	route: string;
	n: number;
	cpu: number;
	wall: number;
}

export interface SqlCost {
	sql: string;
	/// Executions (not counting the prepares).
	n: number;
	/// Ms in `prepare`.
	prepareMs: number;
	/// Ms running it (`all`, `get`, `run`, `iterate`).
	runMs: number;
	/// Slowest single run.
	maxMs: number;
	/// The method that ran it most often.
	method: string;
}

export interface MethodCost {
	/// The server's methods that led to the queries, innermost first.
	method: string;
	/// Queries run.
	queries: number;
	/// Ms in better-sqlite3, prepares included.
	ms: number;
}

export interface RouteCost {
	route: string;
	/// Requests finished.
	n: number;
	/// Ms of JavaScript run on behalf of these requests.
	cpuMs: number;
	/// Ms of it inside better-sqlite3.
	sqlMs: number;
	/// Sum of the requests' time from arrival to the response's end.
	wallMs: number;
}

export interface Breakdown {
	/// Ms in better-sqlite3, prepares included.
	sqlMs: number;
	routes: RouteCost[];
	methods: MethodCost[];
	sql: SqlCost[];
}

export interface SqlSummary extends Breakdown {
	/// The `windowMs` (offsets from the start) when the server ran the most JavaScript.
	peak: Breakdown & { from: number; to: number };
}

/// Frames that only pass the call along.
const PLUMBING = new Set([
	"operation",
	"service.<computed>",
	"inTx",
	"validateArgs",
	"executeAction",
	"callMiddleware",
	"handleMiddleware",
	"withServiceErrors",
	"withActionErrors",
	"callSafely",
	"safeAction",
]);

/// What an anonymous function or a `run:` is part of, from the closest definition above it.
const DEFINITIONS: [RegExp, (name: string) => string][] = [
	[/\b(\w+):\s*defineAction\(/, (name) => `action ${name}`],
	[/\b(?:const|let)\s+(\w+)\s*=\s*op\(\{/, (name) => `op ${name}`],
	[/\bfunction\s+(\w+)\s*\(/, (name) => name],
	[/\b(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(/, (name) => name],
];

/// Names the server's frames (`name@file:line`) from the build in `dist`.
function frameNamer(dist: string): (frame: string) => string | null {
	const files = new Map<string, string[]>();
	const linesOf = (file: string) => {
		let lines = files.get(file);
		if (!lines) {
			const full = path.join(dist, "server", file);
			lines = existsSync(full) ? readFileSync(full, "utf8").split("\n") : [];
			files.set(file, lines);
		}
		return lines;
	};
	const enclosing = (file: string, line: number): string | null => {
		const lines = linesOf(file);
		for (let i = line - 1; i >= 0 && i > line - 400; i--)
			for (const [pattern, name] of DEFINITIONS) {
				const m = lines[i]?.match(pattern);
				if (m?.[1]) return name(m[1]);
			}
		return null;
	};
	const named = new Map<string, string | null>();
	return (frame) => {
		const cached = named.get(frame);
		if (cached !== undefined) return cached;
		const m = frame.match(/^(.*)@(.+):(\d+)$/);
		let name: string | null = frame;
		if (m) {
			const [, fn = "", file = "", line = "0"] = m;
			if (PLUMBING.has(fn)) name = null;
			else if (fn === "run" || fn === "(anonymous)") {
				const found = enclosing(file, Number(line));
				name =
					found && !PLUMBING.has(found)
						? found
						: found
							? null
							: `${fn}@${path.basename(file)}:${line}`;
			} else name = fn;
		}
		named.set(frame, name);
		return name;
	};
}

function readLines<T>(file: string, startedAt: number): T[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as T & { t: number })
		.filter((line) => line.t >= startedAt);
}

function breakdown(
	sqlLines: SqlLine[],
	routeLines: RouteLine[],
	methodOf: (caller: string) => string,
	top: number,
): Breakdown {
	const bySql = new Map<string, SqlCost & { methods: Map<string, number> }>();
	const byMethod = new Map<string, MethodCost>();
	const sqlByRoute = new Map<string, number>();
	let sqlMs = 0;
	for (const line of sqlLines) {
		sqlMs += line.ms;
		sqlByRoute.set(line.route, (sqlByRoute.get(line.route) ?? 0) + line.ms);
		const method = methodOf(line.caller);
		let m = byMethod.get(method);
		if (!m) {
			m = { method, queries: 0, ms: 0 };
			byMethod.set(method, m);
		}
		m.ms += line.ms;
		let cost = bySql.get(line.sql);
		if (!cost) {
			cost = {
				sql: line.sql,
				n: 0,
				prepareMs: 0,
				runMs: 0,
				maxMs: 0,
				method: "",
				methods: new Map(),
			};
			bySql.set(line.sql, cost);
		}
		if (line.op === "prepare") cost.prepareMs += line.ms;
		else {
			m.queries += line.n;
			cost.n += line.n;
			cost.runMs += line.ms;
			cost.maxMs = Math.max(cost.maxMs, line.max);
			cost.methods.set(method, (cost.methods.get(method) ?? 0) + line.n);
		}
	}
	const byRoute = new Map<string, RouteCost>();
	for (const line of routeLines) {
		let r = byRoute.get(line.route);
		if (!r) {
			r = { route: line.route, n: 0, cpuMs: 0, sqlMs: 0, wallMs: 0 };
			byRoute.set(line.route, r);
		}
		r.n += line.n;
		r.cpuMs += line.cpu;
		r.wallMs += line.wall;
	}
	for (const [route, ms] of sqlByRoute) {
		const r = byRoute.get(route);
		if (r) r.sqlMs = ms;
		else byRoute.set(route, { route, n: 0, cpuMs: 0, sqlMs: ms, wallMs: 0 });
	}
	return {
		sqlMs,
		routes: [...byRoute.values()]
			.sort((a, b) => b.cpuMs - a.cpuMs || b.sqlMs - a.sqlMs)
			.slice(0, top),
		methods: [...byMethod.values()].sort((a, b) => b.ms - a.ms).slice(0, top),
		sql: [...bySql.values()]
			.sort((a, b) => b.prepareMs + b.runMs - (a.prepareMs + a.runMs))
			.slice(0, top)
			.map(({ methods, ...cost }) => ({
				...cost,
				method: [...methods].sort((a, b) => b[1] - a[1])[0]?.[0] ?? cost.method,
			})),
	};
}

/// Lines from `startedAt` on; null when the probe wrote nothing.
export function summariseSql(
	dir: string,
	dist: string,
	startedAt: number,
	top = 15,
	windowMs = 30_000,
): SqlSummary | null {
	const sqlLines = readLines<SqlLine>(path.join(dir, "sql.jsonl"), startedAt);
	const routeLines = readLines<RouteLine>(
		path.join(dir, "route.jsonl"),
		startedAt,
	);
	if (sqlLines.length === 0 && routeLines.length === 0) return null;
	const name = frameNamer(dist);
	const methods = new Map<string, string>();
	const methodOf = (caller: string) => {
		let method = methods.get(caller);
		if (method === undefined) {
			const names = caller
				.split(" < ")
				.filter(Boolean)
				.map(name)
				.filter((n): n is string => n !== null);
			method =
				[...new Set(names)].slice(0, 3).join(" < ") || "(outside the server)";
			methods.set(caller, method);
		}
		return method;
	};
	// Busiest window by JavaScript run (or SQL time without routes), sliding by a second.
	const perSecond = new Map<number, number>();
	const weigh = (t: number, ms: number) => {
		const s = Math.floor((t - startedAt) / 1000);
		perSecond.set(s, (perSecond.get(s) ?? 0) + ms);
	};
	if (routeLines.length) for (const l of routeLines) weigh(l.t, l.cpu);
	else for (const l of sqlLines) weigh(l.t, l.ms);
	const span = windowMs / 1000;
	let best = 0;
	let bestMs = -1;
	for (const s of perSecond.keys()) {
		let ms = 0;
		for (let i = s; i < s + span; i++) ms += perSecond.get(i) ?? 0;
		if (ms > bestMs) {
			bestMs = ms;
			best = s;
		}
	}
	const from = startedAt + best * 1000;
	const to = from + windowMs;
	const inPeak = <T extends { t: number }>(lines: T[]) =>
		lines.filter((l) => l.t >= from && l.t < to);
	return {
		...breakdown(sqlLines, routeLines, methodOf, top),
		peak: {
			from: best * 1000,
			to: best * 1000 + windowMs,
			...breakdown(inPeak(sqlLines), inPeak(routeLines), methodOf, top),
		},
	};
}
