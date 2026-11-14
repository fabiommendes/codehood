/**
 * Samples of the machine during a load run, read from `/proc` once a second,
 * and a measure of how long `fsync` takes on the database's disk.
 */

import {
	closeSync,
	fsyncSync,
	openSync,
	readFileSync,
	rmSync,
	writeSync,
} from "node:fs";
import path from "node:path";

export interface SystemSample {
	t: number;
	/// From `/proc/meminfo`, in bytes.
	memAvailable: number;
	cached: number;
	swapUsed: number;
	/// `some avg10` of `/proc/pressure/io` and of `/proc/pressure/cpu`, in percent; null without PSI.
	ioPressure: number | null;
	cpuPressure: number | null;
	/// Share of all cores busy, and waiting on I/O, since the last sample (0..1).
	cpuBusy: number;
	ioWait: number;
	/// The server's resident memory from `/proc/<pid>/status`, in bytes.
	serverRss: number | null;
}

function meminfo(): Record<string, number> {
	const out: Record<string, number> = {};
	for (const line of readFileSync("/proc/meminfo", "utf8").split("\n")) {
		const match = line.match(/^(\w+):\s+(\d+)/);
		if (match?.[1] && match[2]) out[match[1]] = Number(match[2]) * 1024;
	}
	return out;
}

function pressure(kind: "io" | "cpu"): number | null {
	try {
		const match = readFileSync(`/proc/pressure/${kind}`, "utf8").match(
			/^some avg10=([\d.]+)/m,
		);
		return match?.[1] ? Number(match[1]) : null;
	} catch {
		return null;
	}
}

function cpuTimes(): { total: number; idle: number; iowait: number } {
	const first = readFileSync("/proc/stat", "utf8").split("\n")[0] ?? "";
	const fields = first.trim().split(/\s+/).slice(1).map(Number);
	const total = fields.reduce((a, b) => a + b, 0);
	return { total, idle: fields[3] ?? 0, iowait: fields[4] ?? 0 };
}

function rssOf(pid: number): number | null {
	try {
		const match = readFileSync(`/proc/${pid}/status`, "utf8").match(
			/^VmRSS:\s+(\d+)/m,
		);
		return match?.[1] ? Number(match[1]) * 1024 : null;
	} catch {
		return null;
	}
}

/// Samples every second until the returned function is called; it returns the samples.
export function sampleSystem(
	serverPid: () => number | undefined,
): () => SystemSample[] {
	const samples: SystemSample[] = [];
	let previous = cpuTimes();
	const timer = setInterval(() => {
		const memory = meminfo();
		const times = cpuTimes();
		const total = times.total - previous.total || 1;
		const pid = serverPid();
		samples.push({
			t: Date.now(),
			memAvailable: memory.MemAvailable ?? 0,
			cached: memory.Cached ?? 0,
			swapUsed: (memory.SwapTotal ?? 0) - (memory.SwapFree ?? 0),
			ioPressure: pressure("io"),
			cpuPressure: pressure("cpu"),
			cpuBusy:
				1 -
				(times.idle + times.iowait - previous.idle - previous.iowait) / total,
			ioWait: (times.iowait - previous.iowait) / total,
			serverRss: pid ? rssOf(pid) : null,
		});
		previous = times;
	}, 1000);
	return () => {
		clearInterval(timer);
		return samples;
	};
}

export interface FsyncMeasure {
	/// Milliseconds per write + fsync of 4 KiB, over `count` rounds.
	p50: number;
	p99: number;
	mean: number;
	count: number;
}

/// How long a small write followed by `fsync` takes in `dir`, like the commit of a SQLite transaction.
export function measureFsync(dir: string, count = 200): FsyncMeasure {
	const file = path.join(dir, `.fsync-probe-${process.pid}`);
	const fd = openSync(file, "w");
	const block = Buffer.alloc(4096, 7);
	const times: number[] = [];
	try {
		for (let i = 0; i < count; i++) {
			const t0 = performance.now();
			writeSync(fd, block, 0, block.length, (i % 64) * 4096);
			fsyncSync(fd);
			times.push(performance.now() - t0);
		}
	} finally {
		closeSync(fd);
		rmSync(file, { force: true });
	}
	times.sort((a, b) => a - b);
	const at = (q: number) =>
		times[Math.min(times.length - 1, Math.floor(q * times.length))] ?? 0;
	return {
		p50: at(0.5),
		p99: at(0.99),
		mean: times.reduce((a, b) => a + b, 0) / times.length,
		count,
	};
}
