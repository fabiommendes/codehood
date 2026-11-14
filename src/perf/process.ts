/**
 * The periodic line on the state of the process, and the line written as
 * soon as the event loop is held for too long.
 */
import { statSync } from "node:fs";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";
import { logEvent } from "@/utils/log";
import { PERF } from "./config";
import { lastSeen, resetTotals, round, totals } from "./state";

/// How often the stall watch wakes up, in ms.
const STALL_TICK_MS = 100;

const MB = 1024 * 1024;
/// Resolution of the event loop delay samples, in ms.
const LOOP_RESOLUTION_MS = 20;
/// A sample is the time between two ticks, so an idle loop reads one resolution: take it out.
const loopDelayMs = (ns: number) =>
	round(Math.max(0, ns / 1e6 - LOOP_RESOLUTION_MS));
const usToMs = (us: number) => round(us / 1e3);

/// Size of `path` in bytes, or null when it does not exist.
function sizeOf(path: string): number | null {
	try {
		return statSync(path).size;
	} catch {
		return null;
	}
}

/// Logs a stall with the last request and service call seen at work before it.
function watchStalls(): void {
	let expected = performance.now() + STALL_TICK_MS;
	setInterval(() => {
		const now = performance.now();
		const late = now - expected;
		expected = now + STALL_TICK_MS;
		if (late < PERF.stallMs) return;
		logEvent("stall", {
			ms: round(late),
			op: lastSeen.op,
			id: lastSeen.request?.id,
			route: lastSeen.request?.route,
		});
	}, STALL_TICK_MS).unref();
}

const started = Symbol.for("codehood.perf.monitor");

/**
 * Starts the periodic line and the stall watch, once per process; a no-op
 * when the performance log is off.
 *
 * `tables` supplies the row counts of the tables that grow, and a failure of
 * it only leaves them out of the line.
 */
export function startProcessMonitor(
	tables: () => Promise<Record<string, unknown>>,
): void {
	const flags = globalThis as Record<symbol, boolean>;
	if (!PERF.enabled || flags[started]) return;
	flags[started] = true;

	const dbPath = (process.env.DATABASE_URL ?? "file:./dev.db").replace(
		/^file:/,
		"",
	);
	const loop = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
	loop.enable();
	let cpu = process.cpuUsage();
	let utilization = performance.eventLoopUtilization();
	let since = performance.now();

	watchStalls();
	setInterval(async () => {
		const now = performance.now();
		const elapsedMs = now - since;
		since = now;
		const spent = process.cpuUsage(cpu);
		cpu = process.cpuUsage();
		const current = performance.eventLoopUtilization();
		const busy = performance.eventLoopUtilization(current, utilization);
		utilization = current;
		const memory = process.memoryUsage();
		const { commits } = totals;

		const line = {
			rssMb: Math.round(memory.rss / MB),
			heapMb: Math.round(memory.heapUsed / MB),
			cpu: round((spent.user + spent.system) / 1000 / elapsedMs),
			loopBusy: Math.round(busy.utilization * 100) / 100,
			loopP50: loopDelayMs(loop.percentile(50)),
			loopP99: loopDelayMs(loop.percentile(99)),
			loopMax: loopDelayMs(loop.max),
			inFlight: totals.inFlight,
			requests: totals.requests,
			errors: totals.errors,
			queries: totals.queries,
			db: round(totals.dbMs),
			slowestQuery: round(totals.slowestQueryMs),
			txWaiting: totals.txWaiting,
			txWaitMax: round(totals.txWaitMaxMs),
			commits: commits.count,
			commitP99: commits.count ? usToMs(commits.percentile(99)) : 0,
			commitMax: commits.count ? usToMs(commits.max) : 0,
			dbBytes: sizeOf(dbPath),
			walBytes: sizeOf(`${dbPath}-wal`),
		};
		loop.reset();
		resetTotals();

		let counts: Record<string, unknown> = {};
		try {
			counts = await tables();
		} catch {
			// The line is worth more without the counts than not at all.
		}
		logEvent("process", { ...line, ...counts });
	}, PERF.intervalS * 1000).unref();
}
