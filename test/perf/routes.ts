/**
 * Ranks the routes of a performance log by what each request costs, to find
 * the ones that load more as the data grows.
 *
 * It reads the `request` lines (see "Performance log" in `README.md`) of a
 * file, such as a production log taken with `journalctl -u codehood -o cat`,
 * or of every `.jsonl` file of a directory:
 *
 * ```bash
 * pnpm exec tsx test/perf/routes.ts <file or dir> [--top 20] [--sort mean|max|db|queries|total] [--min 1] [--user <username>]
 * ```
 *
 * A request that never answered, because the server died under it, has no
 * line: the ranking only knows the requests that finished.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/// What the requests of one route cost.
export interface RouteCost {
	route: string;
	requests: number;
	/// Wall time per request, in ms; it includes the wait for a busy event loop.
	mean: number;
	p95: number;
	max: number;
	/// Time in SQLite per request, in ms: what the request itself held the event loop for.
	dbMean: number;
	dbMax: number;
	/// Statements per request.
	queriesMean: number;
	queriesMax: number;
	/// Wall time of all its requests, in seconds.
	total: number;
}

/// The orders `rankRoutes` knows, each by the column that names it.
export const SORTS = {
	mean: (cost: RouteCost) => cost.mean,
	max: (cost: RouteCost) => cost.max,
	db: (cost: RouteCost) => cost.dbMean,
	queries: (cost: RouteCost) => cost.queriesMax,
	total: (cost: RouteCost) => cost.total,
} as const;

export type Sort = keyof typeof SORTS;

interface RequestLine {
	route: string;
	ms: number;
	db: number;
	queries: number;
	/// The signed-in user, when there was one.
	user?: string;
}

/** Reads the `request` lines of `source`, a log file or a directory of `.jsonl` files; any other line is skipped. */
export function readRequests(source: string): RequestLine[] {
	const files = statSync(source).isDirectory()
		? readdirSync(source)
				.filter((file) => file.endsWith(".jsonl"))
				.sort()
				.map((file) => path.join(source, file))
		: [source];
	const requests: RequestLine[] = [];
	for (const file of files) {
		for (const text of readFileSync(file, "utf8").split("\n")) {
			if (!text.startsWith("{") || !text.includes('"request"')) continue;
			let line: Record<string, unknown>;
			try {
				line = JSON.parse(text);
			} catch {
				// A line cut short when the server was stopped.
				continue;
			}
			if (line.event !== "request" || typeof line.route !== "string") continue;
			requests.push({
				route: line.route,
				ms: Number(line.ms) || 0,
				db: Number(line.db) || 0,
				queries: Number(line.queries) || 0,
				...(typeof line.user === "string" ? { user: line.user } : {}),
			});
		}
	}
	return requests;
}

/** The cost of each route with at least `min` requests, the most expensive by `sort` first. */
export function rankRoutes(
	requests: RequestLine[],
	sort: Sort = "mean",
	min = 1,
): RouteCost[] {
	const byRoute = new Map<string, RequestLine[]>();
	for (const request of requests) {
		const list = byRoute.get(request.route);
		if (list) list.push(request);
		else byRoute.set(request.route, [request]);
	}
	const costs: RouteCost[] = [];
	for (const [route, list] of byRoute) {
		if (list.length < min) continue;
		const sum = (pick: (request: RequestLine) => number) =>
			list.reduce((total, request) => total + pick(request), 0);
		const largest = (pick: (request: RequestLine) => number) =>
			list.reduce((top, request) => Math.max(top, pick(request)), 0);
		const times = list.map(({ ms }) => ms).sort((a, b) => a - b);
		costs.push({
			route,
			requests: list.length,
			mean: sum(({ ms }) => ms) / list.length,
			p95:
				times[Math.min(times.length - 1, Math.floor(0.95 * times.length))] ?? 0,
			max: largest(({ ms }) => ms),
			dbMean: sum(({ db }) => db) / list.length,
			dbMax: largest(({ db }) => db),
			queriesMean: sum(({ queries }) => queries) / list.length,
			queriesMax: largest(({ queries }) => queries),
			total: sum(({ ms }) => ms) / 1000,
		});
	}
	const key = SORTS[sort];
	return costs.sort((a, b) => key(b) - key(a));
}

function ms(value: number): string {
	return value >= 1000
		? `${(value / 1000).toFixed(1)} s`
		: `${value.toFixed(0)} ms`;
}

/** The ranking as a Markdown table. */
export function routesTable(costs: RouteCost[]): string {
	const header = [
		"route",
		"requests",
		"mean",
		"p95",
		"max",
		"sqlite mean",
		"sqlite max",
		"queries mean",
		"queries max",
		"total",
	];
	const rows = costs.map((cost) => [
		cost.route,
		String(cost.requests),
		ms(cost.mean),
		ms(cost.p95),
		ms(cost.max),
		ms(cost.dbMean),
		ms(cost.dbMax),
		cost.queriesMean.toFixed(0),
		String(cost.queriesMax),
		`${cost.total.toFixed(0)} s`,
	]);
	const widths = header.map((cell, column) =>
		Math.max(cell.length, ...rows.map((row) => (row[column] ?? "").length)),
	);
	const line = (cells: string[]) =>
		`| ${cells
			.map((cell, column) =>
				column === 0
					? cell.padEnd(widths[column] ?? 0)
					: cell.padStart(widths[column] ?? 0),
			)
			.join(" | ")} |`;
	return [
		line(header),
		`|${widths.map((width, column) => `${"-".repeat(width + 1)}${column === 0 ? "-" : ":"}`).join("|")}|`,
		...rows.map(line),
	].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const { values, positionals } = parseArgs({
		allowPositionals: true,
		options: {
			top: { type: "string", default: "20" },
			sort: { type: "string", default: "mean" },
			min: { type: "string", default: "1" },
			user: { type: "string" },
		},
	});
	const [source] = positionals;
	if (!source || !(values.sort in SORTS)) {
		console.error(
			`Usage: tsx test/perf/routes.ts <file or dir> [--top 20] [--sort ${Object.keys(SORTS).join("|")}] [--min 1] [--user <username>]`,
		);
		process.exit(1);
	}
	const requests = readRequests(source);
	const ranked = rankRoutes(
		values.user
			? requests.filter(({ user }) => user === values.user)
			: requests,
		values.sort as Sort,
		Number(values.min),
	);
	console.log(routesTable(ranked.slice(0, Number(values.top))));
}
