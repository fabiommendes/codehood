/**
 * Preloaded into the server under load (`node --import`). The server's code is untouched.
 *
 * - Every second it appends the process's memory, CPU time and event-loop
 *   delay to `LOAD_PROBE_FILE` as one JSON line.
 * - With `LOAD_PROFILE_DIR`, it runs V8's sampling CPU profiler for the whole
 *   life of the process and writes one `.cpuprofile` per minute there, plus
 *   the last partial minute on SIGTERM/SIGINT, so a process that dies loses at
 *   most a minute. The files open in Chrome DevTools or speedscope.
 */

import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";

const file = process.env.LOAD_PROBE_FILE;
if (file) {
	const delay = monitorEventLoopDelay({ resolution: 10 });
	delay.enable();
	let cpu = process.cpuUsage();
	let last = performance.now();
	const timer = setInterval(() => {
		const now = performance.now();
		const used = process.cpuUsage(cpu);
		cpu = process.cpuUsage();
		const memory = process.memoryUsage();
		const ms = (ns) => Math.round(ns / 1e4) / 100;
		appendFileSync(
			file,
			`${JSON.stringify({
				t: Date.now(),
				rss: memory.rss,
				heapUsed: memory.heapUsed,
				heapTotal: memory.heapTotal,
				external: memory.external,
				/// Share of one core the process used since the last line.
				cpu: (used.user + used.system) / 1000 / (now - last),
				lagP50: ms(delay.percentile(50)),
				lagP99: ms(delay.percentile(99)),
				lagMax: ms(delay.max),
			})}\n`,
		);
		last = now;
		delay.reset();
	}, 1000);
	timer.unref();
}

const profileDir = process.env.LOAD_PROFILE_DIR;
if (profileDir) {
	mkdirSync(profileDir, { recursive: true });
	/// Microseconds between two samples (V8's default for `--cpu-prof`).
	const interval = Number(process.env.LOAD_PROFILE_INTERVAL_US ?? 1000);
	const session = new Session();
	session.connect();
	// A session on the main thread answers synchronously, which the SIGTERM handler relies on.
	const post = (method, params) => {
		let result;
		session.post(method, params, (error, value) => {
			if (error) throw error;
			result = value;
		});
		return result;
	};
	post("Profiler.enable");
	post("Profiler.setSamplingInterval", { interval });
	post("Profiler.start");
	let chunk = 0;

	/// Writes what was sampled since the last chunk, then starts sampling again unless `final`.
	const cut = (final) => {
		const { profile } = post("Profiler.stop");
		chunk++;
		writeFileSync(
			path.join(
				profileDir,
				`${String(chunk).padStart(3, "0")}-${Date.now()}.cpuprofile`,
			),
			JSON.stringify(profile),
		);
		if (!final) post("Profiler.start");
	};
	setInterval(() => cut(false), 60_000).unref();

	for (const signal of ["SIGTERM", "SIGINT"]) {
		process.once(signal, () => {
			cut(true);
			// Leave the shutdown to the server when it handles the signal; otherwise exit as the default would.
			if (process.listenerCount(signal) === 0) process.exit(0);
		});
	}
}
