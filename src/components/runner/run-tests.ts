/**
 * Runs the test sources of a code question against an answer in the browser
 * runner and returns an MDQ runner report (`../mdq/docs/runner-report.md`).
 */

import { RunnerHost, RunnerUnavailable } from "@codehood/runner/host";
import {
	elmCases,
	elmModule,
	parseSuite,
	withModuleHeader,
} from "./test-report";

/// One verdict of the report; only `pass` passes.
export type Verdict =
	| "pass"
	| "fail"
	| "error"
	| "timeout"
	| "resource-limit"
	| "skipped";

/** A test case of the report. `source` indexes `tests`, `line` is 1-based in that source. */
export interface ReportCase {
	source: number;
	line?: number;
	verdict: Verdict;
	id?: string;
	message?: string;
	expected?: string;
	actual?: string;
	duration?: number;
}

/** The runner report, as MDQ defines it. */
export interface RunnerReport {
	version?: 1;
	status: "completed" | "build-error" | "runner-error";
	cases: ReportCase[];
	build?: string;
	message?: string;
	runner?: {
		name: string;
		version?: string;
		language?: string;
		toolchainVersion?: string;
	};
}

/** What the runner needs to test one answer. */
export interface TestRun {
	/// Origin of the runner frame (`RUNNER_ORIGIN`). Without it, or on a page
	/// that cannot run code, the report is a `runner-error`.
	runnerOrigin?: string | null;
	/// The question's `language`, e.g. `elm`.
	language: string;
	/// The question's `file`, the name the answer is compiled as.
	file: string;
	answer: string;
	/// Test sources in the order the report's `source` indexes them.
	tests: readonly { format: string; text: string }[];
}

/// Longest a test source may take, runtime download included.
export const TEST_TIMEOUT_MS = 60_000;

/// A report with no cases and the status of a failed run.
function failed(
	status: "build-error" | "runner-error",
	text: string,
): RunnerReport {
	return {
		status,
		cases: [],
		...(status === "build-error" ? { build: text } : { message: text }),
		runner: RUNNER,
	};
}

/// Who signs the reports of this module.
const RUNNER = { name: "codehood-runner", language: "elm" } as const;

/// What the runner frame did with one test source.
type Outcome =
	| { kind: "stdout"; text: string }
	| { kind: "report"; report: RunnerReport };

/// Runs one test source in a `test` mode run of the frame.
async function runSource(
	host: RunnerHost,
	run: TestRun,
	text: string,
	signal: AbortSignal | undefined,
): Promise<Outcome> {
	const module = elmModule(text);
	if (module === null) {
		return {
			kind: "report",
			report: failed("runner-error", "A test source declares no module."),
		};
	}
	const entry = `${module.replaceAll(".", "/")}.elm`;
	if (entry === run.file) {
		return {
			kind: "report",
			report: failed(
				"runner-error",
				`A test source declares the module of the answer, ${module}.`,
			),
		};
	}
	let stdout = "";
	let stderr = "";
	const handle = await host.run(
		{
			language: "elm",
			mode: "test",
			files: {
				[run.file]: withModuleHeader("elm", run.file, run.answer),
				[entry]: text,
			},
			entry,
		},
		{
			onOutput: (stream, chunk) => {
				if (stream === "stdout") stdout += chunk;
				else stderr += chunk;
			},
		},
	);
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		handle.stop();
	}, TEST_TIMEOUT_MS);
	const stop = () => handle.stop();
	signal?.addEventListener("abort", stop, { once: true });
	try {
		const exit = await handle.done;
		if (signal?.aborted) throw signal.reason ?? new Error("Aborted");
		const reason = (message: string) => ({
			kind: "report" as const,
			report: failed("runner-error", message),
		});
		if (timedOut) {
			return reason(
				`The tests did not finish in ${TEST_TIMEOUT_MS / 1000} seconds.`,
			);
		}
		if (exit.reason === "exited" && exit.code === 0) {
			return { kind: "stdout", text: stdout };
		}
		if (exit.reason === "exited" && exit.code === 1) {
			return {
				kind: "report",
				report: failed("build-error", stderr.trim()),
			};
		}
		return reason(
			exit.message ??
				(exit.reason === "exited"
					? stderr.trim() || `The runner exited with ${exit.code}.`
					: `The runner stopped: ${exit.reason}.`),
		);
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", stop);
	}
}

/**
 * Runs `run.tests` against `run.answer` and resolves with the report.
 *
 * Each test source runs in its own run of the runner frame, one after the
 * other. A source that does not build, or a failure of the runner, ends the
 * report there with that status. A language without a test mode resolves
 * with a `runner-error` report.
 *
 * @throws {Error} the abort reason, when `signal` aborts before the report is ready.
 */
export async function runTests(
	run: TestRun,
	signal?: AbortSignal,
): Promise<RunnerReport> {
	if (run.language !== "elm") {
		return failed(
			"runner-error",
			`The runner has no test mode for ${run.language}.`,
		);
	}
	if (!run.runnerOrigin) {
		return failed("runner-error", "The code runner is not available.");
	}
	signal?.throwIfAborted();
	const host = RunnerHost.shared(run.runnerOrigin);
	const cases: ReportCase[] = [];
	for (const [source, test] of run.tests.entries()) {
		let outcome: Outcome;
		try {
			outcome = await runSource(host, run, test.text, signal);
		} catch (error) {
			if (error instanceof RunnerUnavailable) {
				return failed("runner-error", "The code runner is not available.");
			}
			throw error;
		}
		if (outcome.kind === "report") return outcome.report;
		const suite = parseSuite(outcome.text);
		if (!suite) {
			return failed("runner-error", "The runner wrote an unreadable report.");
		}
		if ("invalid" in suite) {
			return failed("runner-error", `Invalid test source: ${suite.invalid}`);
		}
		cases.push(...elmCases(source, test.text, suite.cases));
	}
	return { status: "completed", cases, runner: RUNNER };
}
