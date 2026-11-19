/**
 * Runs the exam load test: builds the server, and for each scenario seeds a
 * fresh database, starts the server (with the probe, under optional resource
 * limits), the grading workers and the synthetic students, then writes the
 * report. See `test/load/README.md`.
 *
 *     pnpm run load --students 100 --duration 10m --scenario all
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { Recorder } from "./http";
import { runInstructor } from "./instructor";
import type { GradingWait } from "./page";
import { summariseProfiles } from "./profile";
import {
	answerOf,
	CODE_QUESTIONS,
	ESSAY_QUESTIONS,
	type Variant,
} from "./questions";
import {
	type GeneratorSample,
	htmlReport,
	type LoadReport,
	markdownReport,
	type ProbeSample,
	type ScenarioResult,
	type TxSample,
} from "./report";
import { clientRhythm } from "./rhythm";
import { LOAD } from "./setup";
import { summariseSql } from "./sql";
import {
	type Behaviour,
	Dice,
	type LoadQuestion,
	runStudent,
	type StudentRun,
	seededRandom,
} from "./student";
import { measureFsync, sampleSystem } from "./system";

const ROOT = path.resolve(import.meta.dirname, "../..");
const BIN = path.join(ROOT, "node_modules/.bin");

const { values: args } = parseArgs({
	options: {
		students: { type: "string", default: "100" },
		history: { type: "string", default: "0" },
		"history-bytes": { type: "string", default: "900" },
		instructor: { type: "string", default: "0" },
		"commit-delay": { type: "string", default: "0" },
		duration: { type: "string", default: "10m" },
		ramp: { type: "string", default: "2m" },
		scenario: { type: "string", default: "all" },
		"grading-workers": { type: "string", default: "1,4" },
		"worker-poll": { type: "string", default: "10" },
		"worker-cpu": { type: "string", default: "none" },
		wal: { type: "string", default: "on" },
		memory: { type: "string" },
		cpu: { type: "string" },
		port: { type: "string", default: "4590" },
		seed: { type: "string", default: "1" },
		cooldown: { type: "string", default: "15s" },
		out: { type: "string" },
		resume: { type: "string" },
		"skip-build": { type: "boolean", default: false },
		"no-profile": { type: "boolean", default: false },
		environment: { type: "string", default: "prod" },
	},
});

function durationMs(text: string): number {
	const match = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
	if (!match) throw new Error(`Not a duration: ${text}`);
	const unit =
		{ ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] ?? "s"] ?? 1000;
	return Number(match[1]) * unit;
}

const STUDENTS = Number(args.students);
const DURATION = durationMs(args.duration);
const RAMP = durationMs(args.ramp);
const COOLDOWN = durationMs(args.cooldown);
const INSTRUCTOR = durationMs(args.instructor);
const COMMIT_DELAY = durationMs(args["commit-delay"]);
/// What systemd waits before it starts a server that died again.
const RESTART_DELAY = 2_000;
const PORT = Number(args.port);
const BASE = `http://localhost:${PORT}`;
const WORKDIR = path.join(ROOT, ".load");
const DIST = path.join(WORKDIR, "dist");
const OUT =
	args.resume ??
	args.out ??
	path.join(
		WORKDIR,
		"reports",
		new Date().toISOString().replaceAll(":", "-").slice(0, 19),
	);

interface Scenario {
	name: string;
	description: string;
	behaviour: Behaviour;
	workers: number;
	/// CPUQuota of each worker (`100%` is one core); null leaves them free.
	workerCpu: string | null;
	wal: boolean;
	ramp: number;
	/// Defaults to `--students` and `--duration`.
	students?: number;
	duration?: number;
}

function describeWorkers(workers: number, cpu: string | null): string {
	if (workers === 0) return "no grading worker";
	const who = `${workers} grading worker${workers === 1 ? "" : "s"}`;
	return cpu ? `${who} limited to CPUQuota=${cpu}` : who;
}

function scenarios(): Scenario[] {
	const which =
		args.scenario === "all"
			? ["baseline", "monitor", "queue", "combined"]
			: args.scenario.split(",");
	const workerCounts = args["grading-workers"].split(",").map(Number);
	const workerCpus = args["worker-cpu"]
		.split(",")
		.map((cpu) => (cpu === "none" ? null : cpu));
	// Each worker count with each CPU limit; without workers the limit means nothing.
	const workerSetups = workerCounts.flatMap((workers) =>
		(workers === 0 ? [null] : workerCpus).map((workerCpu) => ({
			workers,
			workerCpu,
			label: `${workers}w${workerCpu ? `-cpu${workerCpu.replace("%", "")}` : ""}`,
		})),
	);
	const wal = { off: [false], on: [true], both: [false, true] }[args.wal];
	if (!wal) throw new Error("--wal is off, on or both");
	const list: Scenario[] = [];
	for (const walOn of wal) {
		const suffix = walOn ? "+wal" : "";
		for (const name of which) {
			if (name === "baseline")
				list.push({
					name: `baseline${suffix}`,
					description:
						"The reference without load: 3 students at the pace of a real exam, with 1 grading worker.",
					behaviour: { typing: true, sends: true, history: true, burst: false },
					workers: 1,
					workerCpu: null,
					wal: walOn,
					ramp: 10_000,
					students: Math.min(3, STUDENTS),
					duration: Math.min(DURATION, 180_000),
				});
			else if (name === "monitor")
				list.push({
					name: `monitor${suffix}`,
					description:
						"Suspect 1, the monitoring of the students: everyone types, autosave and edit history, no sends and no worker.",
					behaviour: {
						typing: true,
						sends: false,
						history: true,
						burst: false,
					},
					workers: 0,
					workerCpu: null,
					wal: walOn,
					ramp: RAMP,
				});
			else if (name === "queue" || name === "combined")
				for (const { workers, workerCpu, label } of workerSetups)
					list.push({
						name: `${name}-${label}${suffix}`,
						description:
							name === "queue"
								? `Suspect 2, the grading queue: every student sends every code question at once, no typing, and polls until graded; ${describeWorkers(workers, workerCpu)}.`
								: `The pace of a real exam: typing, edit history and sends spread over time; ${describeWorkers(workers, workerCpu)}.`,
						behaviour:
							name === "queue"
								? { typing: false, sends: true, history: false, burst: true }
								: { typing: true, sends: true, history: true, burst: false },
						workers,
						workerCpu,
						wal: walOn,
						ramp: name === "queue" ? Math.min(RAMP, 30_000) : RAMP,
					});
			else throw new Error(`Unknown scenario ${name}`);
		}
	}
	return list;
}

/// The exam's questions as the students see them, with their candidate answers.
function loadQuestions(): LoadQuestion[] {
	const variants: Variant[] = [
		"correct",
		"failsPretest",
		"failsHidden",
		"noCompile",
	];
	return [
		...CODE_QUESTIONS.map((q) => ({
			slug: q.slug,
			type: "code",
			stem: q.stem,
			sendable: true,
			answers: variants.map((variant) => ({
				text: answerOf(q, variant),
				outcome: variant,
			})),
		})),
		...ESSAY_QUESTIONS.map((q) => ({
			slug: q.slug,
			type: "essay",
			stem: q.stem,
			sendable: false,
			answers: [{ text: q.answer, outcome: "full" }],
		})),
	];
}

function run(
	command: string,
	argv: string[],
	env: NodeJS.ProcessEnv = {},
): void {
	const result = spawnSync(command, argv, {
		cwd: ROOT,
		env: { ...process.env, ...env },
		stdio: ["ignore", "inherit", "inherit"],
	});
	if (result.status !== 0)
		throw new Error(
			`${command} ${argv.join(" ")} exited with ${result.status}`,
		);
}

/// The settings of the server, the build and the seed.
function serverEnv(dir: string): NodeJS.ProcessEnv {
	return {
		DATABASE_URL: `file:${path.join(dir, "load.db")}`,
		RESOURCE_ROOT: path.join(dir, "resources"),
		REPOSITORY_ROOT: path.join(dir, "repos"),
		PUBLIC_URL: BASE,
		HOST: "127.0.0.1",
		PORT: String(PORT),
		SERVER_TZ: process.env.SERVER_TZ ?? "America/Sao_Paulo",
		CODEHOOD_CONFIG: "test/codehood.config.ts",
		ENVIRONMENT: args.environment,
		NODE_ENV: "production",
	};
}

function build(): void {
	if (args["skip-build"] && existsSync(path.join(DIST, "server/entry.mjs")))
		return;
	console.log("[load] building the server…");
	run(path.join(BIN, "astro"), ["build", "--outDir", DIST], serverEnv(WORKDIR));
}

function prepareDatabase(dir: string): void {
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(path.join(dir, "resources"), { recursive: true });
	const env = serverEnv(dir);
	run(
		path.join(BIN, "prisma"),
		["db", "push", "--url", env.DATABASE_URL as string, "--accept-data-loss"],
		{
			...env,
			PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION:
				"Yes, allow it for the load-test DB only",
		},
	);
	run(
		path.join(BIN, "tsx"),
		[
			"test/load/seed.ts",
			"--students",
			String(STUDENTS),
			"--history",
			args.history,
			"--history-bytes",
			args["history-bytes"],
		],
		env,
	);
}

interface Server {
	pid: () => number | undefined;
	errors: string[];
	/// The exits of the server while it was meant to run, each with the second of the run it happened at.
	exits: string[];
	stop: () => Promise<void>;
}

/// Starts the server and, like `Restart=on-failure`, starts it again whenever it dies.
function startServer(dir: string, wal: boolean): Server {
	const errors: string[] = [];
	const exits: string[] = [];
	const startedAt = Date.now();
	writeFileSync(path.join(dir, "server.log"), "");
	let stopping = false;
	let child = spawnServer(dir, wal, errors);
	const watch = (current: ChildProcess) => {
		current.on("exit", (code, signal) => {
			if (stopping) return;
			exits.push(
				`code ${code} signal ${signal} at ${Math.round((Date.now() - startedAt) / 1000)} s`,
			);
			console.log(`[load] the server died (${exits.at(-1)}); restarting`);
			setTimeout(() => {
				if (stopping) return;
				child = spawnServer(dir, wal, errors);
				watch(child);
			}, RESTART_DELAY);
		});
	};
	watch(child);
	return {
		pid: () => child.pid,
		errors,
		exits,
		stop: () => {
			stopping = true;
			return stop(child);
		},
	};
}

function spawnServer(
	dir: string,
	wal: boolean,
	errors: string[],
): ChildProcess {
	const probe = path.join(dir, "probe.jsonl");
	const node = [
		process.execPath,
		"--import",
		path.join(ROOT, "test/load/probe.mjs"),
		"--import",
		path.join(ROOT, "test/load/probe-db.mjs"),
		path.join(DIST, "server/entry.mjs"),
	];
	const limits: string[] = [];
	if (args.memory)
		limits.push("-p", `MemoryMax=${args.memory}`, "-p", "MemorySwapMax=0");
	if (args.cpu) limits.push("-p", `CPUQuota=${args.cpu}`);
	const [command = process.execPath, ...argv] = limits.length
		? ["systemd-run", "--user", "--scope", "--quiet", ...limits, "--", ...node]
		: node;
	const child = spawn(command, argv, {
		cwd: ROOT,
		env: {
			...process.env,
			...serverEnv(dir),
			// The server sets the journal mode itself, on every connection.
			DATABASE_JOURNAL_MODE: wal ? "wal" : "delete",
			LOAD_PROBE_FILE: probe,
			LOAD_TX_FILE: path.join(dir, "tx.jsonl"),
			LOAD_SQL_FILE: path.join(dir, "sql.jsonl"),
			LOAD_ROUTE_FILE: path.join(dir, "route.jsonl"),
			// A commit in WAL does not pay what the delay stands for.
			...(COMMIT_DELAY > 0 && !wal
				? { LOAD_COMMIT_DELAY_MS: String(COMMIT_DELAY) }
				: {}),
			...(args["no-profile"]
				? {}
				: { LOAD_PROFILE_DIR: path.join(dir, "profile") }),
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	const log = path.join(dir, "server.log");
	for (const stream of [child.stdout, child.stderr]) {
		stream?.on("data", (chunk: Buffer) => {
			const text = chunk.toString();
			writeFileSync(log, text, { flag: "a" });
			for (const line of text.split("\n"))
				if (
					/error|ERR|SQLITE_BUSY|timed out|ECONN/i.test(line) &&
					errors.length < 50
				)
					errors.push(line.slice(0, 300));
		});
	}
	return child;
}

async function waitForServer(server: Server): Promise<void> {
	const until = Date.now() + 60_000;
	while (Date.now() < until) {
		if (server.exits.length > 0)
			throw new Error(`The server exited: ${server.exits[0]}`);
		try {
			const response = await fetch(`${BASE}/api/health`);
			if (response.ok) return;
		} catch {
			// Not up yet.
		}
		await new Promise((resolve) => setTimeout(resolve, 300));
	}
	throw new Error("The server did not answer /api/health in 60 s");
}

function startWorkers(
	count: number,
	cpu: string | null,
	dir: string,
): ChildProcess[] {
	const workers: ChildProcess[] = [];
	for (let index = 0; index < count; index++) {
		const log = path.join(dir, `worker-${index}.log`);
		writeFileSync(log, "");
		const worker = [
			"uv",
			"run",
			"--quiet",
			"--project",
			"workers/chalk-worker",
			"chalk-worker",
			"--server",
			BASE,
			"--course",
			`${LOAD.discipline}/${LOAD.courseSegment}`,
			"--exam",
			LOAD.exam,
			"--poll",
			args["worker-poll"],
			// A cache per worker, kept between runs: the first build of each question is slow.
			"--cache-dir",
			path.join(WORKDIR, "worker-cache", String(index)),
		];
		// The worker and everything it runs (elm, elm-test, node) share the quota.
		const [command = "uv", ...argv] = cpu
			? [
					"systemd-run",
					"--user",
					"--scope",
					"--quiet",
					"-p",
					`CPUQuota=${cpu}`,
					"--",
					...worker,
				]
			: worker;
		const child = spawn(command, argv, {
			cwd: ROOT,
			env: { ...process.env, CODEHOOD_BOT_KEY: LOAD.botKey },
			stdio: ["ignore", "pipe", "pipe"],
		});
		for (const stream of [child.stdout, child.stderr])
			stream?.on("data", (chunk: Buffer) =>
				writeFileSync(log, chunk, { flag: "a" }),
			);
		workers.push(child);
	}
	return workers;
}

async function stop(
	child: ChildProcess,
	signal: NodeJS.Signals = "SIGTERM",
	ms = 30_000,
): Promise<void> {
	if (child.exitCode !== null || child.signalCode !== null) return;
	const exited = new Promise<void>((resolve) =>
		child.once("exit", () => resolve()),
	);
	child.kill(signal);
	const timer = setTimeout(() => child.kill("SIGKILL"), ms);
	await exited;
	clearTimeout(timer);
}

/// This process's event-loop delay and CPU, per second: when the generator
/// itself is busy, the latencies it measures include its own delay.
function sampleGenerator(): { stop: () => GeneratorSample[] } {
	const samples: GeneratorSample[] = [];
	const delay = monitorEventLoopDelay({ resolution: 10 });
	delay.enable();
	let cpu = process.cpuUsage();
	let last = performance.now();
	const timer = setInterval(() => {
		const now = performance.now();
		const used = process.cpuUsage(cpu);
		cpu = process.cpuUsage();
		samples.push({
			t: Date.now(),
			cpu: (used.user + used.system) / 1000 / (now - last),
			lagP99: delay.percentile(99) / 1e6,
			lagMax: delay.max / 1e6,
		});
		last = now;
		delay.reset();
	}, 1000);
	return {
		stop: () => {
			clearInterval(timer);
			delay.disable();
			return samples;
		},
	};
}

function readProbe(dir: string): ProbeSample[] {
	return readLines(path.join(dir, "probe.jsonl"));
}

function readLines<T>(file: string): T[] {
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
}

async function runScenario(
	scenario: Scenario,
	index: number,
): Promise<ScenarioResult> {
	const dir = path.join(OUT, scenario.name);
	console.log(`\n[load] ${scenario.name}: ${scenario.description}`);
	prepareDatabase(dir);
	const server = startServer(dir, scenario.wal);
	await waitForServer(server);
	const stopSampling = sampleSystem(server.pid);
	const workers = startWorkers(scenario.workers, scenario.workerCpu, dir);

	const startedAt = Date.now();
	const recorder = new Recorder(startedAt);
	const generator = sampleGenerator();
	const gradingWaits: GradingWait[] = [];
	const rhythm = clientRhythm();
	const questions = loadQuestions();
	const master = seededRandom(Number(args.seed) * 1000 + index);
	const progress = setInterval(() => {
		const elapsed = Math.round((Date.now() - startedAt) / 1000);
		const recent = recorder.samples.filter(
			(s) => s.at > Date.now() - startedAt - 10_000,
		);
		const failures = recent.filter(
			(s) => s.status === 0 || s.status >= 500,
		).length;
		console.log(
			`[load] ${scenario.name} ${elapsed}s: ${(recent.length / 10).toFixed(1)} req/s, ${failures} failures in the last 10 s`,
		);
	}, 10_000);

	let examOver = false;
	const instructor =
		INSTRUCTOR > 0
			? runInstructor({
					base: BASE,
					recorder,
					interval: INSTRUCTOR,
					history: Number(args.history) > 0,
					done: () => examOver,
				})
			: Promise.resolve();
	const runs: StudentRun[] = await Promise.all(
		Array.from({ length: scenario.students ?? STUDENTS }, (_, i) => {
			const dice = new Dice(seededRandom(Math.floor(master() * 2 ** 32)));
			return runStudent({
				base: BASE,
				target: {
					discipline: LOAD.discipline,
					course: LOAD.courseSegment,
					exam: LOAD.exam,
				},
				username: LOAD.student(i + 1),
				password: LOAD.password,
				questions,
				rhythm,
				recorder,
				gradingWaits,
				behaviour: scenario.behaviour,
				dice,
				arriveAt: dice.between([0, scenario.ramp]),
				deadline: scenario.duration ?? DURATION,
				thinkBudgetMs: (scenario.duration ?? DURATION) * 0.5,
				startedAt,
			});
		}),
	);
	examOver = true;
	await instructor;
	clearInterval(progress);
	const generatorSamples = generator.stop();
	const endedAt = Date.now();
	for (const worker of workers) await stop(worker, "SIGINT");
	// The server stays up, idle, so the report shows whether its memory comes back down.
	await new Promise((resolve) => setTimeout(resolve, COOLDOWN));
	const system = stopSampling();
	const serverExit =
		server.exits.length > 0
			? `${server.exits.length} time${server.exits.length === 1 ? "" : "s"}, restarted after each (${server.exits.join("; ")})`
			: undefined;
	await server.stop();
	return {
		name: scenario.name,
		description: scenario.description,
		students: scenario.students ?? STUDENTS,
		generator: generatorSamples,
		gradingWorkers: scenario.workers,
		workerCpu: scenario.workerCpu,
		wal: scenario.wal,
		startedAt,
		endedAt,
		samples: recorder.samples,
		// Before the students the server is warming up, which is not load.
		probe: readProbe(dir).filter((sample) => sample.t >= startedAt),
		system,
		gradingWaits,
		runs,
		serverErrors: server.errors,
		profile: summariseProfiles(path.join(dir, "profile")),
		sql: summariseSql(dir, DIST, startedAt),
		transactions: readLines<TxSample>(path.join(dir, "tx.jsonl")).filter(
			(tx) => tx.t >= startedAt,
		),
		...(serverExit ? { serverExit } : {}),
	};
}

mkdirSync(OUT, { recursive: true });
build();
const fsync = measureFsync(OUT);
console.log(
	`[load] fsync of 4 KiB: p50 ${fsync.p50.toFixed(2)} ms, p99 ${fsync.p99.toFixed(2)} ms`,
);

const results: ScenarioResult[] = [];
for (const [index, scenario] of scenarios().entries()) {
	// Each scenario keeps its result on disk, so `--resume <dir>` skips the ones done.
	const saved = path.join(OUT, scenario.name, "result.json");
	if (args.resume && existsSync(saved)) {
		console.log(`[load] ${scenario.name}: kept from ${saved}`);
		results.push(JSON.parse(readFileSync(saved, "utf8")));
		continue;
	}
	const result = await runScenario(scenario, index);
	writeFileSync(saved, JSON.stringify(result));
	results.push(result);
}

const report: LoadReport = {
	createdAt: new Date().toISOString(),
	options: args,
	fsync,
	limits: {
		memory: args.memory ?? null,
		cpu: args.cpu ?? null,
		commitDelayMs: COMMIT_DELAY,
	},
	scenarios: results,
};
writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report));
const markdown = markdownReport(report);
writeFileSync(path.join(OUT, "report.md"), markdown);
writeFileSync(path.join(OUT, "report.html"), htmlReport(report));
console.log(`\n${markdown}\n[load] report: ${path.join(OUT, "report.html")}`);
process.exit(0);
