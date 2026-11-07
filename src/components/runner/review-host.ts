/**
 * The runner of a grading page: one exclusive host for the whole page, with
 * a fresh sandbox for each submission.
 */

import type { RunHandle, RunHandlers, RunRequest } from "@/runner/host";

/**
 * Runs `request` as a run of `submission` on the page's review host.
 *
 * The page has one `RunnerHost.exclusive(runnerOrigin)`, created on first
 * use, so at most one run exists at a time: a new run stops the previous
 * one, whatever widget started it. When `submission` differs from the
 * submission of the previous run, the host is reloaded first
 * (`RunnerHost.reload()`), so no state of one student's code reaches the
 * next. Running the same submission again, original or modified copy, reuses
 * the frame; each run still gets a new Worker.
 *
 * Calls are handled one at a time, in order, and the last one wins: a call
 * made while an earlier one is still waiting (for `reload()` or for the run
 * to start) supersedes it. A superseded call never starts a run; it resolves
 * with a handle whose `done` is `{ reason: "stopped", code: null }` and whose
 * other methods do nothing.
 *
 * Reloading the frame also drops its reserve Workers, so the first run of
 * each submission loads its runtime cold (seconds for Python).
 *
 * @throws {RunnerUnavailable} as `RunnerHost.run` does.
 */
export async function runForSubmission(
	_runnerOrigin: string,
	_submission: string,
	_request: RunRequest,
	_handlers: RunHandlers,
): Promise<RunHandle> {
	throw new Error("not implemented");
}
