/**
 * Turns the samples of a load run into the report: a table per scenario in
 * the terminal, `report.json`, and `report.html` with the series over time.
 */

import type { Sample } from "./http";
import type { GradingWait } from "./page";
import type { HotFunction, ProfileSummary } from "./profile";
import type { Breakdown, SqlSummary } from "./sql";
import type { StudentRun } from "./student";
import type { FsyncMeasure, SystemSample } from "./system";

export interface ProbeSample {
	t: number;
	rss: number;
	heapUsed: number;
	heapTotal: number;
	external: number;
	cpu: number;
	lagP50: number;
	lagP99: number;
	lagMax: number;
}

/// One transaction of the server, from `probe-db.mjs`.
export interface TxSample {
	/// When it asked for the adapter's mutex (epoch ms).
	t: number;
	/// Ms waiting for the mutex.
	wait: number;
	/// Ms holding it, from `BEGIN` to the commit or rollback.
	hold: number;
	/// Transactions already waiting when it asked.
	queued: number;
	ok: boolean;
}

/// The load generator's own event loop and CPU, per second.
export interface GeneratorSample {
	t: number;
	/// Share of one core.
	cpu: number;
	lagP99: number;
	lagMax: number;
}

export interface ScenarioResult {
	name: string;
	description: string;
	students: number;
	/// Absent in older reports.
	generator?: GeneratorSample[];
	gradingWorkers: number;
	/// CPUQuota of each worker; null or absent when free.
	workerCpu?: string | null;
	wal: boolean;
	startedAt: number;
	endedAt: number;
	samples: Sample[];
	probe: ProbeSample[];
	system: SystemSample[];
	gradingWaits: GradingWait[];
	runs: StudentRun[];
	/// Lines of the server's stderr/stdout that look like errors, at most a few.
	serverErrors: string[];
	/// Exit of the server process, when it died during the run.
	serverExit?: string;
	/// The server's CPU profile, from its start to its stop (null with `--no-profile`).
	profile?: ProfileSummary | null;
	/// Every transaction the server ran during the scenario (absent in older reports).
	transactions?: TxSample[];
	/// Time in better-sqlite3 per SQL text (absent in older reports).
	sql?: SqlSummary | null;
}

export interface LoadReport {
	createdAt: string;
	options: Record<string, unknown>;
	fsync: FsyncMeasure;
	/// `commitDelayMs` is absent in older reports.
	limits: { memory: string | null; cpu: string | null; commitDelayMs?: number };
	scenarios: ScenarioResult[];
}

export interface ActionStats {
	name: string;
	count: number;
	errors: number;
	codes: Record<string, number>;
	p50: number;
	p95: number;
	p99: number;
	max: number;
	/// Requests per second over the scenario.
	rate: number;
}

export function quantile(sorted: number[], q: number): number {
	if (sorted.length === 0) return Number.NaN;
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ??
		Number.NaN
	);
}

export function actionStats(result: ScenarioResult): ActionStats[] {
	const seconds = Math.max(1, (result.endedAt - result.startedAt) / 1000);
	const groups = new Map<string, Sample[]>();
	for (const sample of result.samples) {
		const group = groups.get(sample.name) ?? [];
		group.push(sample);
		groups.set(sample.name, group);
	}
	return [...groups]
		.map(([name, samples]) => {
			const times = samples.map((s) => s.ms).sort((a, b) => a - b);
			const codes: Record<string, number> = {};
			let errors = 0;
			for (const s of samples) {
				if (!s.error) continue;
				// A refused business rule (no sends left, attempt closed) is not a server failure.
				codes[s.error] = (codes[s.error] ?? 0) + 1;
				if (isFailure(s)) errors++;
			}
			return {
				name,
				count: samples.length,
				errors,
				codes,
				p50: quantile(times, 0.5),
				p95: quantile(times, 0.95),
				p99: quantile(times, 0.99),
				max: times.at(-1) ?? Number.NaN,
				rate: samples.length / seconds,
			};
		})
		.sort((a, b) => b.count - a.count);
}

/// Whether a request failed because of the server (5xx, timeout, connection), not a rule.
export function isFailure(sample: Sample): boolean {
	return sample.status === 0 || sample.status >= 500;
}

export interface Headline {
	requests: number;
	failures: number;
	p95: number;
	p99: number;
	lagP99Max: number;
	/// The generator's own worst event-loop delay: above ~100 ms, its latencies include it.
	generatorLagMax: number;
	generatorCpuMax: number;
	lagMax: number;
	rssMax: number;
	rssEnd: number;
	cpuMean: number;
	ioPressureMax: number | null;
	swapMax: number;
	gradingP50: number;
	gradingP95: number;
	gradingPending: number;
}

export function headline(result: ScenarioResult): Headline {
	const times = result.samples.map((s) => s.ms).sort((a, b) => a - b);
	const graded = result.gradingWaits
		.filter((w) => w.ms !== null)
		.map((w) => w.ms as number)
		.sort((a, b) => a - b);
	const io = result.system
		.map((s) => s.ioPressure)
		.filter((v): v is number => v !== null);
	const max = (values: number[]) =>
		values.length ? Math.max(...values) : Number.NaN;
	return {
		requests: result.samples.length,
		failures: result.samples.filter(isFailure).length,
		p95: quantile(times, 0.95),
		p99: quantile(times, 0.99),
		lagP99Max: max(result.probe.map((p) => p.lagP99)),
		generatorLagMax: max((result.generator ?? []).map((g) => g.lagMax)),
		generatorCpuMax: max((result.generator ?? []).map((g) => g.cpu)),
		lagMax: max(result.probe.map((p) => p.lagMax)),
		rssMax: max(result.probe.map((p) => p.rss)),
		rssEnd: result.probe.at(-1)?.rss ?? Number.NaN,
		cpuMean: result.probe.length
			? result.probe.reduce((a, p) => a + p.cpu, 0) / result.probe.length
			: Number.NaN,
		ioPressureMax: io.length ? Math.max(...io) : null,
		swapMax: max(result.system.map((s) => s.swapUsed)),
		gradingP50: quantile(graded, 0.5),
		gradingP95: quantile(graded, 0.95),
		gradingPending: result.gradingWaits.filter((w) => w.ms === null).length,
	};
}

const ms = (v: number) => (Number.isFinite(v) ? `${Math.round(v)} ms` : "—");
const mb = (v: number) =>
	Number.isFinite(v) ? `${Math.round(v / 2 ** 20)} MB` : "—";
const sec = (v: number) =>
	Number.isFinite(v) ? `${(v / 1000).toFixed(1)} s` : "—";

function table(rows: string[][]): string {
	const head = rows[0] ?? [];
	const widths = head.map((_, c) =>
		Math.max(...rows.map((r) => (r[c] ?? "").length)),
	);
	const line = (r: string[]) =>
		`| ${r.map((cell, c) => cell.padEnd(widths[c] ?? 0)).join(" | ")} |`;
	return [
		line(head),
		`|${widths.map((w) => "-".repeat(w + 2)).join("|")}|`,
		...rows.slice(1).map(line),
	].join("\n");
}

/// The report as Markdown, for the terminal and `report.md`.
export function markdownReport(report: LoadReport): string {
	const out: string[] = ["# Load test", ""];
	out.push(
		`fsync of 4 KiB in the database's directory: p50 ${report.fsync.p50.toFixed(2)} ms, p99 ${report.fsync.p99.toFixed(2)} ms (${report.fsync.count} rounds).`,
		`Server limits: memory ${report.limits.memory ?? "none"}, CPU ${report.limits.cpu ?? "none"}${report.limits.commitDelayMs ? `, every commit outside WAL held ${report.limits.commitDelayMs} ms longer` : ""}.`,
		"",
		"## Scenarios",
		"",
	);
	out.push(
		table([
			[
				"scenario",
				"requests",
				"failures",
				"p95",
				"p99",
				"loop lag p99 (max)",
				"generator lag max (cpu max)",
				"rss max",
				"rss end",
				"cpu",
				"io psi max",
				"grading p50",
				"grading p95",
				"not graded",
			],
			...report.scenarios.map((s) => {
				const h = headline(s);
				return [
					s.name,
					String(h.requests),
					String(h.failures),
					ms(h.p95),
					ms(h.p99),
					ms(h.lagP99Max),
					Number.isFinite(h.generatorLagMax)
						? `${ms(h.generatorLagMax)} (${Math.round(h.generatorCpuMax * 100)}%)`
						: "—",
					mb(h.rssMax),
					mb(h.rssEnd),
					Number.isFinite(h.cpuMean) ? `${Math.round(h.cpuMean * 100)}%` : "—",
					h.ioPressureMax === null ? "—" : `${h.ioPressureMax.toFixed(0)}%`,
					sec(h.gradingP50),
					sec(h.gradingP95),
					String(h.gradingPending),
				];
			}),
		]),
		"",
	);
	for (const scenario of report.scenarios) {
		out.push(`## ${scenario.name}`, "", scenario.description, "");
		out.push(
			`${scenario.students} students, ${scenario.gradingWorkers} grading workers${scenario.workerCpu ? ` (CPUQuota=${scenario.workerCpu} each)` : ""}, WAL ${scenario.wal ? "on" : "off"}, ${sec(scenario.endedAt - scenario.startedAt)}.`,
		);
		if (scenario.serverExit)
			out.push(`**The server died during the run: ${scenario.serverExit}.**`);
		const profiles = new Map<string, StudentRun[]>();
		for (const run of scenario.runs)
			profiles.set(run.profile, [...(profiles.get(run.profile) ?? []), run]);
		out.push(
			"",
			`Students: ${[...profiles].map(([name, runs]) => `${runs.length} ${name}`).join(", ")}; ${scenario.runs.filter((r) => r.finished).length} handed in, ${scenario.runs.reduce((a, r) => a + r.sends, 0)} sends, ${scenario.runs.filter((r) => r.failure).length} failed.`,
		);
		const failures = [
			...new Set(scenario.runs.flatMap((r) => (r.failure ? [r.failure] : []))),
		];
		if (failures.length)
			out.push(`Student failures: ${failures.slice(0, 5).join("; ")}`);
		out.push(
			"",
			table([
				[
					"action",
					"count",
					"req/s",
					"p50",
					"p95",
					"p99",
					"max",
					"failures",
					"codes",
				],
				...actionStats(scenario).map((a) => [
					a.name,
					String(a.count),
					a.rate.toFixed(1),
					ms(a.p50),
					ms(a.p95),
					ms(a.p99),
					ms(a.max),
					String(a.errors),
					Object.entries(a.codes)
						.map(([code, n]) => `${code}×${n}`)
						.join(" "),
				]),
			]),
			"",
		);
		if (scenario.transactions?.length)
			out.push(...transactionSection(scenario));
		if (scenario.sql) out.push(...sqlSection(scenario.sql));
		if (scenario.profile) out.push(...profileSection(scenario.profile));
		if (scenario.serverErrors.length)
			out.push(
				"Server errors (first lines):",
				"",
				"```",
				...scenario.serverErrors.slice(0, 10),
				"```",
				"",
			);
	}
	return out.join("\n");
}

/// How long the server's transactions waited for, and held, the adapter's single mutex.
function transactionSection(result: ScenarioResult): string[] {
	const txs = result.transactions ?? [];
	const sorted = (key: "wait" | "hold") =>
		txs.map((tx) => tx[key]).sort((a, b) => a - b);
	const row = (label: string, values: number[]) => [
		label,
		ms(quantile(values, 0.5)),
		ms(quantile(values, 0.95)),
		ms(quantile(values, 0.99)),
		ms(values.at(-1) ?? Number.NaN),
	];
	const seconds = Math.max(1, (result.endedAt - result.startedAt) / 1000);
	const held = txs.reduce((a, tx) => a + tx.hold, 0);
	const longest = [...txs].sort((a, b) => b.hold - a.hold).slice(0, 5);
	return [
		`Transactions: ${txs.length} (${txs.filter((tx) => !tx.ok).length} rolled back), mutex held ${((100 * held) / (seconds * 1000)).toFixed(1)}% of the run, at most ${txs.reduce((a, tx) => Math.max(a, tx.queued), 0)} waiting at once. Longest holds: ${longest.map((tx) => `${ms(tx.hold)} at ${sec(tx.t - result.startedAt)}`).join(", ")}.`,
		"",
		table([
			["mutex", "p50", "p95", "p99", "max"],
			row("wait", sorted("wait")),
			row("hold", sorted("hold")),
		]),
		"",
	];
}

/// Where the server's time went: per route, per method of the server, per SQL.
function sqlSection(sql: SqlSummary): string[] {
	const code = (text: string, max = 110) =>
		`\`${(text.length > max ? `${text.slice(0, max)}…` : text).replaceAll("|", "\\|").replaceAll("`", "'")}\``;
	const tables = (part: Breakdown) => [
		table([
			["route", "requests", "cpu", "cpu/req", "of it sqlite", "wall/req"],
			...part.routes
				.slice(0, 12)
				.map((r) => [
					r.route,
					String(r.n),
					ms(r.cpuMs),
					r.n ? `${(r.cpuMs / r.n).toFixed(1)} ms` : "—",
					ms(r.sqlMs),
					r.n ? ms(r.wallMs / r.n) : "—",
				]),
		]),
		"",
		table([
			["method (innermost first)", "queries", "sqlite"],
			...part.methods
				.slice(0, 12)
				.map((m) => [code(m.method, 90), String(m.queries), ms(m.ms)]),
		]),
		"",
		table([
			["sql", "runs", "prepare", "run", "max run", "mostly from"],
			...part.sql
				.slice(0, 10)
				.map((c) => [
					code(c.sql, 90),
					String(c.n),
					ms(c.prepareMs),
					ms(c.runMs),
					ms(c.maxMs),
					code(c.method, 50),
				]),
		]),
		"",
	];
	return [
		`Server time by route, method and SQL (\`probe-db.mjs\`): ${sec(sql.sqlMs)} in better-sqlite3 in all.`,
		"",
		...tables(sql),
		`Busiest 30 s (${sec(sql.peak.from)}–${sec(sql.peak.to)}): ${sec(sql.peak.sqlMs)} in better-sqlite3.`,
		"",
		...tables(sql.peak),
	];
}

/// The functions that took the server's CPU: on top of the stack (self) and anywhere in it (total).
function profileSection(profile: ProfileSummary): string[] {
	const busy = profile.sampledMs - profile.idleMs;
	const share = (v: number) =>
		busy > 0 ? `${((100 * v) / busy).toFixed(1)}%` : "—";
	const rows = (list: HotFunction[], key: "selfMs" | "totalMs") =>
		table([
			["function", key === "selfMs" ? "self" : "total", "share of busy"],
			...list
				.slice(0, 15)
				.map((f) => [`\`${f.name}\``, ms(f[key]), share(f[key])]),
		]);
	return [
		`CPU profile (${profile.files.length} files in \`profile/\`): ${sec(profile.sampledMs)} sampled, ${sec(busy)} busy, ${sec(profile.gcMs)} in GC.`,
		"",
		"By self time:",
		"",
		rows(profile.bySelf, "selfMs"),
		"",
		"By total time:",
		"",
		rows(profile.byTotal, "totalMs"),
		"",
	];
}

interface Series {
	title: string;
	unit: string;
	points: [number, number][];
	format: (v: number) => string;
}

/// Requests per second, and their p95, in buckets of `bucketMs`.
function requestSeries(
	result: ScenarioResult,
	bucketMs = 5000,
): { rate: Series; p95: Series; failures: Series } {
	const buckets = new Map<number, number[]>();
	const failed = new Map<number, number>();
	for (const s of result.samples) {
		const b = Math.floor(s.at / bucketMs);
		buckets.set(b, [...(buckets.get(b) ?? []), s.ms]);
		if (isFailure(s)) failed.set(b, (failed.get(b) ?? 0) + 1);
	}
	const keys = [...buckets.keys()].sort((a, b) => a - b);
	const x = (b: number) => (b * bucketMs) / 1000;
	return {
		rate: {
			title: "Requests per second",
			unit: "req/s",
			points: keys.map((b) => [
				x(b),
				(buckets.get(b)?.length ?? 0) / (bucketMs / 1000),
			]),
			format: (v) => v.toFixed(1),
		},
		p95: {
			title: "Request latency, p95 per 5 s",
			unit: "ms",
			points: keys.map((b) => [
				x(b),
				quantile(
					(buckets.get(b) ?? []).sort((p, q) => p - q),
					0.95,
				),
			]),
			format: (v) => `${Math.round(v)} ms`,
		},
		failures: {
			title: "Failed requests per 5 s (5xx, timeout, connection)",
			unit: "",
			points: keys.map((b) => [x(b), failed.get(b) ?? 0]),
			format: (v) => String(v),
		},
	};
}

/// The mutex's wait (p95) and its share held, in buckets of `bucketMs`.
function transactionSeries(result: ScenarioResult, bucketMs = 5000): Series[] {
	const txs = result.transactions ?? [];
	if (txs.length === 0) return [];
	const buckets = new Map<number, TxSample[]>();
	for (const tx of txs) {
		const b = Math.floor((tx.t - result.startedAt) / bucketMs);
		const bucket = buckets.get(b);
		if (bucket) bucket.push(tx);
		else buckets.set(b, [tx]);
	}
	const keys = [...buckets.keys()].sort((a, b) => a - b);
	const x = (b: number) => (b * bucketMs) / 1000;
	return [
		{
			title: "Transaction wait for the mutex, p95 per 5 s",
			unit: "ms",
			points: keys.map((b) => [
				x(b),
				quantile(
					(buckets.get(b) ?? []).map((tx) => tx.wait).sort((m, n) => m - n),
					0.95,
				),
			]),
			format: (v) => `${Math.round(v)} ms`,
		},
		{
			title: "Mutex held (share of each 5 s)",
			unit: "%",
			points: keys.map((b) => [
				x(b),
				Math.min(
					100,
					(100 * (buckets.get(b) ?? []).reduce((a, tx) => a + tx.hold, 0)) /
						bucketMs,
				),
			]),
			format: (v) => `${Math.round(v)}%`,
		},
	];
}

function seriesOf(result: ScenarioResult): Series[] {
	const t0 = result.startedAt;
	const at = (t: number) => (t - t0) / 1000;
	const requests = requestSeries(result);
	return [
		requests.rate,
		requests.p95,
		requests.failures,
		...transactionSeries(result),
		...(result.generator?.length
			? [
					{
						title: "Load generator's event-loop delay, max per second",
						unit: "ms",
						points: result.generator.map((g): [number, number] => [
							at(g.t),
							g.lagMax,
						]),
						format: (v: number) => `${Math.round(v)} ms`,
					},
				]
			: []),
		{
			title: "Event-loop delay, p99 per second",
			unit: "ms",
			points: result.probe.map((p) => [at(p.t), p.lagP99]),
			format: (v) => `${v.toFixed(1)} ms`,
		},
		{
			title: "Server CPU (share of one core)",
			unit: "%",
			points: result.probe.map((p) => [at(p.t), p.cpu * 100]),
			format: (v) => `${Math.round(v)}%`,
		},
		{
			title: "Server resident memory (rss)",
			unit: "MB",
			points: result.probe.map((p) => [at(p.t), p.rss / 2 ** 20]),
			format: (v) => `${Math.round(v)} MB`,
		},
		{
			title: "Server JS heap used",
			unit: "MB",
			points: result.probe.map((p) => [at(p.t), p.heapUsed / 2 ** 20]),
			format: (v) => `${Math.round(v)} MB`,
		},
		{
			title: "I/O pressure, some avg10",
			unit: "%",
			points: result.system
				.filter((s) => s.ioPressure !== null)
				.map((s) => [at(s.t), s.ioPressure as number]),
			format: (v) => `${v.toFixed(1)}%`,
		},
		{
			title: "Machine memory available",
			unit: "MB",
			points: result.system.map((s) => [at(s.t), s.memAvailable / 2 ** 20]),
			format: (v) => `${Math.round(v)} MB`,
		},
		{
			title: "Swap in use",
			unit: "MB",
			points: result.system.map((s) => [at(s.t), s.swapUsed / 2 ** 20]),
			format: (v) => `${Math.round(v)} MB`,
		},
	];
}

const W = 560;
const H = 180;
const PAD = { l: 52, r: 12, t: 12, b: 26 };

function niceMax(v: number): number {
	if (!Number.isFinite(v) || v <= 0) return 1;
	const p = 10 ** Math.floor(Math.log10(v));
	return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v) ?? v;
}

function chart(series: Series): string {
	const points = series.points.filter(([, y]) => Number.isFinite(y));
	if (points.length === 0)
		return `<figure class="chart"><figcaption>${series.title}</figcaption><p class="empty">No data.</p></figure>`;
	const xMax = Math.max(...points.map(([x]) => x), 1);
	const yMax = niceMax(Math.max(...points.map(([, y]) => y)));
	const sx = (x: number) => PAD.l + (x / xMax) * (W - PAD.l - PAD.r);
	const sy = (y: number) => H - PAD.b - (y / yMax) * (H - PAD.t - PAD.b);
	const path = points
		.map(
			([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`,
		)
		.join("");
	const ticks = [0, 0.5, 1].map((f) => f * yMax);
	const data = JSON.stringify(
		points.map(([x, y]) => [Math.round(x * 10) / 10, y, series.format(y)]),
	);
	return `<figure class="chart">
<figcaption>${series.title}</figcaption>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.title}" data-points='${data.replaceAll("'", "&#39;")}' data-sx="${PAD.l},${W - PAD.r},${xMax}" data-sy="${H - PAD.b},${PAD.t},${yMax}">
${ticks.map((v) => `<line class="grid" x1="${PAD.l}" x2="${W - PAD.r}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tick" x="${PAD.l - 6}" y="${sy(v) + 4}" text-anchor="end">${series.format(v)}</text>`).join("")}
<text class="tick" x="${PAD.l}" y="${H - 6}">0 s</text><text class="tick" x="${W - PAD.r}" y="${H - 6}" text-anchor="end">${Math.round(xMax)} s</text>
<path class="line" d="${path}"/>
<line class="cross" x1="0" x2="0" y1="${PAD.t}" y2="${H - PAD.b}" visibility="hidden"/>
<circle class="dot" r="4" visibility="hidden"/>
</svg>
<output class="tip"></output>
</figure>`;
}

const STYLE = `
:root { color-scheme: light; --surface: #fcfcfb; --text: #0b0b0b; --muted: #52514e; --grid: #e4e3df; --series: #2a78d6; --bad: #e34948; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { color-scheme: dark; --surface: #1a1a19; --text: #f0efec; --muted: #c3c2b7; --grid: #34332f; --series: #3987e5; } }
:root[data-theme="dark"] { color-scheme: dark; --surface: #1a1a19; --text: #f0efec; --muted: #c3c2b7; --grid: #34332f; --series: #3987e5; }
body { background: var(--surface); color: var(--text); font: 14px/1.45 system-ui, sans-serif; margin: 0 auto; max-width: 1200px; padding: 16px; }
h1, h2 { font-weight: 600; } p, figcaption, .tick { color: var(--muted); }
.table-wrap { overflow-x: auto; }
table { border-collapse: collapse; font-variant-numeric: tabular-nums; font-size: 13px; }
th, td { padding: 4px 10px; border-bottom: 1px solid var(--grid); text-align: right; white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
.grid-charts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 360px), 1fr)); gap: 16px; }
.chart { margin: 0; position: relative; }
.chart svg { width: 100%; height: auto; display: block; }
.grid { stroke: var(--grid); stroke-width: 1; }
.tick { font-size: 11px; fill: var(--muted); }
.line { fill: none; stroke: var(--series); stroke-width: 2; stroke-linejoin: round; }
.cross { stroke: var(--muted); stroke-width: 1; }
.dot { fill: var(--series); stroke: var(--surface); stroke-width: 2; }
.tip { display: block; min-height: 1.4em; font-size: 12px; color: var(--text); font-variant-numeric: tabular-nums; }
.empty { font-size: 12px; }
`;

const SCRIPT = `
for (const svg of document.querySelectorAll("svg[data-points]")) {
  const points = JSON.parse(svg.dataset.points);
  const [l, r, xMax] = svg.dataset.sx.split(",").map(Number);
  const [b, t, yMax] = svg.dataset.sy.split(",").map(Number);
  const cross = svg.querySelector(".cross"), dot = svg.querySelector(".dot");
  const tip = svg.parentElement.querySelector(".tip");
  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const x = ((event.clientX - box.left) / box.width) * ${W};
    const value = ((x - l) / (r - l)) * xMax;
    let best = points[0];
    for (const p of points) if (Math.abs(p[0] - value) < Math.abs(best[0] - value)) best = p;
    const px = l + (best[0] / xMax) * (r - l), py = b - (best[1] / yMax) * (b - t);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
    tip.textContent = best[0] + " s: " + best[2];
  });
  svg.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.textContent = ""; });
}
`;

function htmlTable(markdown: string): string {
	const rows = markdown
		.split("\n")
		.filter((l) => l.startsWith("|") && !l.startsWith("|-"));
	const cells = rows.map((r) =>
		r
			.slice(1, -1)
			.split("|")
			.map((c) =>
				escapeHtml(c.trim()).replace(/`([^`]+)`/g, "<code>$1</code>"),
			),
	);
	return `<div class="table-wrap"><table><thead><tr>${(cells[0] ?? []).map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${cells
		.slice(1)
		.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
		.join("")}</tbody></table></div>`;
}

function escapeHtml(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

/// The report as a standalone HTML page.
export function htmlReport(report: LoadReport): string {
	const md = markdownReport(report);
	const sections = md.split(/\n## /);
	const body: string[] = [
		`<h1>Load test</h1>`,
		`<p>${escapeHtml(report.createdAt)}. ${escapeHtml((sections[0] ?? "").split("\n").slice(2).join(" "))}</p>`,
	];
	for (const section of sections.slice(1)) {
		const [title, ...rest] = section.split("\n");
		const text = rest.join("\n");
		const scenario = report.scenarios.find((s) => s.name === title);
		body.push(`<h2>${escapeHtml(title ?? "")}</h2>`);
		for (const paragraph of text.split("\n\n")) {
			if (paragraph.trim().startsWith("|")) body.push(htmlTable(paragraph));
			else if (paragraph.trim().startsWith("```"))
				body.push(`<pre>${escapeHtml(paragraph.replaceAll("```", ""))}</pre>`);
			else if (paragraph.trim()) body.push(`<p>${escapeHtml(paragraph)}</p>`);
		}
		if (scenario)
			body.push(
				`<div class="grid-charts">${seriesOf(scenario).map(chart).join("\n")}</div>`,
			);
	}
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exam load test</title><style>${STYLE}</style></head>
<body>${body.join("\n")}<script>${SCRIPT}</script></body></html>`;
}
