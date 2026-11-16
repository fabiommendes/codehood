/**
 * Reads the performance log of an e2e run (`TEST_PERF_LOG`) and compares two
 * runs of the same specs route by route.
 *
 * ```bash
 * pnpm exec tsx test/perf/report.ts <dir>          # one run
 * pnpm exec tsx test/perf/report.ts <base> <full>  # two runs
 * ```
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/// One line of the performance log.
export type Line = { event: string } & Record<string, unknown>;

/// What a run measured for one route.
export interface RouteStats {
	route: string;
	n: number;
	/// Median and largest ms in SQLite per request.
	db: number;
	dbMax: number;
	/// Median and largest number of statements per request.
	queries: number;
	queriesMax: number;
	/// Median wall time per request.
	ms: number;
}

/// A route measured in two runs, and how much its time in SQLite grew.
export interface RouteChange {
	route: string;
	base: RouteStats;
	full: RouteStats;
	/// `full.db / base.db`.
	ratio: number;
}

/// A slow statement of a run, by SQL text.
export interface SlowSql {
	sql: string;
	n: number;
	max: number;
	ops: string[];
	routes: string[];
}

/** Reads every JSON line of the `.jsonl` files in `dir`; anything else in them is skipped. */
export function readLog(dir: string): Line[] {
	const lines: Line[] = [];
	for (const file of readdirSync(dir).sort()) {
		if (!file.endsWith(".jsonl")) continue;
		for (const text of readFileSync(path.join(dir, file), "utf8").split("\n")) {
			if (!text.startsWith("{")) continue;
			try {
				lines.push(JSON.parse(text));
			} catch {
				// A line cut short when the server was stopped.
			}
		}
	}
	return lines;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

const numbers = (lines: Line[], key: string) =>
	lines.map((line) => Number(line[key] ?? 0));

/** Groups the `request` lines by route. */
export function routeStats(lines: Line[]): Map<string, RouteStats> {
	const byRoute = new Map<string, Line[]>();
	for (const line of lines) {
		if (line.event !== "request") continue;
		const route = String(line.route);
		const group = byRoute.get(route);
		if (group) group.push(line);
		else byRoute.set(route, [line]);
	}
	const stats = new Map<string, RouteStats>();
	for (const [route, group] of byRoute) {
		const db = numbers(group, "db");
		const queries = numbers(group, "queries");
		stats.set(route, {
			route,
			n: group.length,
			db: median(db),
			dbMax: Math.max(...db),
			queries: median(queries),
			queriesMax: Math.max(...queries),
			ms: median(numbers(group, "ms")),
		});
	}
	return stats;
}

/// Below this many ms in SQLite a route is noise: a ratio over it means nothing.
const DB_FLOOR_MS = 0.5;

/**
 * Pairs the routes both runs hit, slowest growth in SQLite time first.
 *
 * The ratio is taken over the medians, with both raised to a floor of 0.5 ms
 * so a route that went from 0.1 to 0.3 ms does not lead the list.
 */
export function compareRoutes(
	base: Map<string, RouteStats>,
	full: Map<string, RouteStats>,
): RouteChange[] {
	const changes: RouteChange[] = [];
	for (const [route, before] of base) {
		const after = full.get(route);
		if (!after) continue;
		const ratio =
			Math.max(after.db, DB_FLOOR_MS) / Math.max(before.db, DB_FLOOR_MS);
		changes.push({ route, base: before, full: after, ratio });
	}
	return changes.sort((a, b) => b.ratio - a.ratio);
}

/** Groups the `slow-query` lines by SQL text, slowest first. */
export function slowSql(lines: Line[]): SlowSql[] {
	const bySql = new Map<
		string,
		SlowSql & { opSet: Set<string>; routeSet: Set<string> }
	>();
	for (const line of lines) {
		if (line.event !== "slow-query") continue;
		const sql = String(line.sql);
		let entry = bySql.get(sql);
		if (!entry) {
			entry = {
				sql,
				n: 0,
				max: 0,
				ops: [],
				routes: [],
				opSet: new Set(),
				routeSet: new Set(),
			};
			bySql.set(sql, entry);
		}
		entry.n++;
		entry.max = Math.max(entry.max, Number(line.ms));
		if (line.op) entry.opSet.add(String(line.op));
		if (line.route) entry.routeSet.add(String(line.route));
	}
	return [...bySql.values()]
		.map(({ opSet, routeSet, ...entry }) => ({
			...entry,
			ops: [...opSet].sort(),
			routes: [...routeSet].sort(),
		}))
		.sort((a, b) => b.max - a.max);
}

const fixed = (value: number) => value.toFixed(1);

function table(header: string[], rows: string[][]): string {
	const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
	return [
		line(header),
		line(header.map((_, i) => (i === 0 ? ":--" : "--:"))),
		...rows.map(line),
	].join("\n");
}

function slowSqlSection(
	title: string,
	entries: SlowSql[],
	limit: number,
): string {
	if (entries.length === 0) return `## ${title}\n\nNone.\n`;
	const items = entries
		.slice(0, limit)
		.map(
			(entry) =>
				`- **${fixed(entry.max)} ms** max, ${entry.n}×, in ${entry.ops.join(", ") || "no service"} (${entry.routes.slice(0, 3).join("; ") || "no request"})\n\n  \`\`\`sql\n  ${entry.sql}\n  \`\`\``,
		);
	return `## ${title}\n\n${items.join("\n")}\n`;
}

/** The report of one run, in Markdown: the routes that spend most time in SQLite and the slow statements. */
export function reportRun(lines: Line[], limit = 25): string {
	const routes = [...routeStats(lines).values()].sort((a, b) => b.db - a.db);
	const rows = routes
		.slice(0, limit)
		.map((r) => [
			`\`${r.route}\``,
			String(r.n),
			fixed(r.db),
			fixed(r.dbMax),
			String(r.queries),
			String(r.queriesMax),
			fixed(r.ms),
		]);
	return [
		`# Performance of the run\n`,
		`${routes.length} routes, ${routes.reduce((sum, r) => sum + r.n, 0)} requests.\n`,
		`## Routes by time in SQLite\n`,
		table(
			[
				"Route",
				"n",
				"db p50",
				"db max",
				"queries p50",
				"queries max",
				"ms p50",
			],
			rows,
		),
		"",
		slowSqlSection("Slow statements", slowSql(lines), limit),
	].join("\n");
}

/**
 * The report of a base run against a run on a full database, in Markdown.
 *
 * A route is listed as suspect when its median time in SQLite at least
 * doubled and reached 10 ms on the full database; `threshold` and `floor`
 * change the factor and the time. Below the floor a fraction of a
 * millisecond of jitter is enough to double a route.
 */
export function reportComparison(
	base: Line[],
	full: Line[],
	threshold = 2,
	floor = 10,
	limit = 40,
): string {
	const changes = compareRoutes(routeStats(base), routeStats(full));
	const suspects = changes.filter(
		(change) => change.ratio >= threshold && change.full.db >= floor,
	);
	const row = (change: RouteChange) => [
		`\`${change.route}\``,
		`${change.base.n}/${change.full.n}`,
		fixed(change.base.db),
		fixed(change.full.db),
		`${change.ratio.toFixed(1)}×`,
		fixed(change.full.dbMax),
		`${change.base.queries}/${change.full.queries}`,
	];
	const header = [
		"Route",
		"n base/full",
		"db base",
		"db full",
		"growth",
		"db max full",
		"queries base/full",
	];
	const baseSql = new Set(slowSql(base).map((entry) => entry.sql));
	const newSlow = slowSql(full).filter((entry) => !baseSql.has(entry.sql));

	return [
		`# Base database against full database\n`,
		`${changes.length} routes hit in both runs; ${suspects.length} grew ${threshold}× or more in median SQLite time, to ${floor} ms or more.\n`,
		`## Routes that grew\n`,
		suspects.length
			? table(header, suspects.slice(0, limit).map(row))
			: "None.",
		"",
		slowSqlSection("Statements slow only on the full database", newSlow, limit),
		`## Every route, by growth\n`,
		table(header, changes.slice(0, limit).map(row)),
		"",
	].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [first, second] = process.argv.slice(2);
	if (!first) {
		console.error("usage: tsx test/perf/report.ts <dir> [<full dir>]");
		process.exit(1);
	}
	console.log(
		second
			? reportComparison(readLog(first), readLog(second))
			: reportRun(readLog(first)),
	);
}
