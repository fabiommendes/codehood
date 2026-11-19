/**
 * Compares how often the students save in production with how often the
 * synthetic ones do, to tune `PROFILES` in `student.ts` against a real exam.
 *
 * It reads the `request` lines of a production performance log (see
 * "Performance log" in `README.md`), the `report.json` of a load run, or both:
 *
 *     pnpm exec tsx test/load/calibrate.ts --log exam.jsonl --report .load/reports/<run>/report.json
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { LoadReport } from "./report";

/// The saves of one student, as epoch or run milliseconds.
type Saves = Map<string, number[]>;

const SAVE_ROUTE = "POST /_actions/exam.answer";

/// The saves in a production log, skipping the lines that are not JSON.
function savesOfLog(file: string): Saves {
	const saves: Saves = new Map();
	for (const line of readFileSync(file, "utf8").split("\n")) {
		if (!line.startsWith("{") || !line.includes(SAVE_ROUTE)) continue;
		let event: { event?: string; route?: string; user?: string; at?: string };
		try {
			event = JSON.parse(line);
		} catch {
			continue;
		}
		if (event.event !== "request" || event.route !== SAVE_ROUTE) continue;
		if (!event.user || !event.at) continue;
		push(saves, event.user, Date.parse(event.at));
	}
	return saves;
}

/// The saves of one scenario of a load report, sends included, as in the production log.
function savesOfReport(report: LoadReport, scenario: string): Saves {
	const saves: Saves = new Map();
	const found = report.scenarios.find(({ name }) => name === scenario);
	if (!found) throw new Error(`No scenario ${scenario} in the report`);
	for (const sample of found.samples) {
		if (!sample.name.startsWith("exam.answer") || !sample.who) continue;
		push(saves, sample.who, found.startedAt + sample.at);
	}
	return saves;
}

function push(saves: Saves, who: string, at: number): void {
	const list = saves.get(who);
	if (list) list.push(at);
	else saves.set(who, [at]);
}

interface Rhythm {
	students: number;
	saves: number;
	/// Seconds between two saves of the same student.
	gaps: number[];
	/// Saves in each minute a student saved at all.
	perActiveMinute: number[];
	/// Saves per minute of each student, from the first save to the last.
	perMinute: number[];
	/// Share of those minutes in which each student saved.
	activeShare: number[];
}

function rhythmOf(saves: Saves): Rhythm {
	const rhythm: Rhythm = {
		students: saves.size,
		saves: 0,
		gaps: [],
		perActiveMinute: [],
		perMinute: [],
		activeShare: [],
	};
	for (const times of saves.values()) {
		times.sort((a, b) => a - b);
		rhythm.saves += times.length;
		for (let i = 1; i < times.length; i++)
			rhythm.gaps.push(((times[i] ?? 0) - (times[i - 1] ?? 0)) / 1000);
		const minutes = new Map<number, number>();
		for (const t of times) {
			const minute = Math.floor(t / 60_000);
			minutes.set(minute, (minutes.get(minute) ?? 0) + 1);
		}
		rhythm.perActiveMinute.push(...minutes.values());
		const span = ((times.at(-1) ?? 0) - (times[0] ?? 0)) / 60_000;
		if (span < 1) continue;
		rhythm.perMinute.push(times.length / span);
		rhythm.activeShare.push(Math.min(1, minutes.size / span));
	}
	return rhythm;
}

function quantile(values: number[], q: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return (
		sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
	);
}

const GAP_BUCKETS: [number, number][] = [
	[0, 1],
	[1, 2],
	[2, 5],
	[5, 15],
	[15, 60],
	[60, Number.POSITIVE_INFINITY],
];

/// The rows of the comparison, as `[label, value of each rhythm]`.
function rows(rhythms: Rhythm[]): string[][] {
	const each = (value: (rhythm: Rhythm) => string) => rhythms.map(value);
	const quantiles = (
		label: string,
		pick: (r: Rhythm) => number[],
		digits = 1,
	) =>
		[0.1, 0.5, 0.9].map((q) => [
			`${label} p${q * 100}`,
			...each((r) => quantile(pick(r), q).toFixed(digits)),
		]);
	return [
		["students", ...each((r) => String(r.students))],
		["saves", ...each((r) => String(r.saves))],
		...quantiles("saves per student-minute", (r) => r.perMinute),
		...quantiles("saves per active minute", (r) => r.perActiveMinute, 0),
		...quantiles("share of minutes with a save", (r) => r.activeShare, 2),
		...[0.25, 0.5, 0.75, 0.9].map((q) => [
			`gap between saves p${q * 100} (s)`,
			...each((r) => quantile(r.gaps, q).toFixed(2)),
		]),
		...GAP_BUCKETS.map(([low, high]) => [
			`gaps of ${low} to ${Number.isFinite(high) ? high : "∞"} s`,
			...each((r) => {
				const inside = r.gaps.filter((gap) => gap >= low && gap < high).length;
				return `${((100 * inside) / Math.max(1, r.gaps.length)).toFixed(1)}%`;
			}),
		]),
	];
}

function table(header: string[], body: string[][]): string {
	const widths = header.map((cell, column) =>
		Math.max(cell.length, ...body.map((row) => (row[column] ?? "").length)),
	);
	const line = (cells: string[]) =>
		`| ${cells.map((cell, column) => cell.padEnd(widths[column] ?? 0)).join(" | ")} |`;
	return [
		line(header),
		`|${widths.map((width) => "-".repeat(width + 2)).join("|")}|`,
		...body.map(line),
	].join("\n");
}

const { values: args } = parseArgs({
	options: {
		log: { type: "string" },
		report: { type: "string" },
		scenario: { type: "string" },
	},
});
if (!args.log && !args.report) {
	console.error(
		"Usage: tsx test/load/calibrate.ts [--log <production.jsonl>] [--report <report.json> [--scenario <name>]]",
	);
	process.exit(1);
}

const header = [""];
const rhythms: Rhythm[] = [];
if (args.log) {
	header.push("production");
	rhythms.push(rhythmOf(savesOfLog(args.log)));
}
if (args.report) {
	const report: LoadReport = JSON.parse(readFileSync(args.report, "utf8"));
	const names = args.scenario
		? args.scenario.split(",")
		: report.scenarios.map(({ name }) => name);
	for (const name of names) {
		header.push(name);
		rhythms.push(rhythmOf(savesOfReport(report, name)));
	}
}
console.log(table(header, rows(rhythms)));
