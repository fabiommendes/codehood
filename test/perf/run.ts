/**
 * Runs the e2e specs twice with the performance log on, first on the seeded
 * database and then on the same database plus bulk data (`test/fill/`), and
 * reports the routes whose time in SQLite grew.
 *
 * ```bash
 * pnpm run test:perf                              # the whole e2e scope, scale 1
 * pnpm run test:perf --scale 0.2 test/foo.spec.ts # some specs, less data
 * pnpm run test:perf --base .perf/<run>/base      # reuse a base run
 * pnpm run test:perf --threshold 3 --floor 5      # growth factor and ms that make a suspect
 * ```
 *
 * Everything after the options is forwarded to `test/run.ts`. The logs and
 * `report.md` go to `.perf/<time>/`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readLog, reportComparison } from "./report";

const argv = process.argv.slice(2);

/// Removes `--name value` from `argv` and returns the value.
function option(name: string): string | undefined {
	const index = argv.indexOf(`--${name}`);
	if (index === -1) return undefined;
	const [, value] = argv.splice(index, 2);
	return value;
}

const scale = option("scale") ?? "1";
const reusedBase = option("base");
const threshold = Number(option("threshold") ?? 2);
/// Median SQLite time, in ms, below which a route that grew is not reported.
const floor = Number(option("floor") ?? 10);
/// Statements at or above it are logged with their SQL, in both runs.
const slowQueryMs = option("slow-query-ms") ?? "5";

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const out = path.resolve(".perf", stamp);
const baseDir = reusedBase ? path.resolve(reusedBase) : path.join(out, "base");
const fullDir = path.join(out, "full");
mkdirSync(fullDir, { recursive: true });
if (!reusedBase) mkdirSync(baseDir, { recursive: true });

/// Runs the e2e scope with its servers logging to `dir`; returns the exit status.
function runSuite(dir: string, env: NodeJS.ProcessEnv): number {
	const result = spawnSync(
		"node_modules/.bin/tsx",
		["test/run.ts", "--scope=e2e", ...argv],
		{
			stdio: "inherit",
			env: {
				...process.env,
				TEST_PERF_LOG: dir,
				PERF_SLOW_QUERY_MS: slowQueryMs,
				...env,
			},
		},
	);
	return result.status ?? 1;
}

let baseStatus = 0;
if (!reusedBase) {
	console.log(`[perf] base run → ${baseDir}`);
	baseStatus = runSuite(baseDir, {});
}
console.log(`[perf] full run (scale ${scale}) → ${fullDir}`);
const fullStatus = runSuite(fullDir, { TEST_FILL: scale });

const report = reportComparison(
	readLog(baseDir),
	readLog(fullDir),
	threshold,
	floor,
);
const reportFile = path.join(out, "report.md");
writeFileSync(reportFile, report);
console.log(`\n${report}`);
console.log(`[perf] report: ${reportFile}`);
// A spec that fails only on the full database is a finding, not a broken run.
if (baseStatus !== 0) console.log("[perf] the base run had failing specs.");
if (fullStatus !== 0) console.log("[perf] the full run had failing specs.");
process.exit(baseStatus);
