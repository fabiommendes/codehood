/**
 * Switches and thresholds of the performance log, read once from the
 * environment. The object is mutable so a spec can turn the log on.
 */

/// A number from the environment, or `fallback` when it is absent or not a number.
function readNumber(name: string, fallback: number): number {
	const raw = process.env[name]?.trim();
	const value = Number(raw);
	return raw && Number.isFinite(value) ? value : fallback;
}

/// A switch from the environment: `1`/`true` or `0`/`false`, else `fallback`.
function readSwitch(name: string, fallback: boolean): boolean {
	const raw = process.env[name]?.trim().toLowerCase();
	if (raw === "1" || raw === "true") return true;
	if (raw === "0" || raw === "false") return false;
	return fallback;
}

const production = /^(prod|production)$/.test(process.env.ENVIRONMENT ?? "");

export const PERF = {
	/// `PERF_LOG`. On by default in production only.
	enabled: readSwitch("PERF_LOG", production),
	/// `PERF_SLOW_QUERY_MS`. A SQL statement at or above it gets its own line.
	slowQueryMs: readNumber("PERF_SLOW_QUERY_MS", 100),
	/// `PERF_SLOW_SERVICE_MS`. A service call at or above it gets its own line.
	slowServiceMs: readNumber("PERF_SLOW_SERVICE_MS", 100),
	/// `PERF_STALL_MS`. An event loop held at least this long gets its own line.
	stallMs: readNumber("PERF_STALL_MS", 200),
	/// `PERF_INTERVAL_S`. Seconds between two lines on the state of the process.
	intervalS: readNumber("PERF_INTERVAL_S", 60),
};
