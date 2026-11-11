/**
 * The runner of a grading page: one exclusive host for the whole page, with
 * a fresh sandbox for each submission.
 */

import {
	type RunExit,
	type RunHandle,
	type RunHandlers,
	RunnerHost,
	type RunRequest,
} from "@codehood/runner/host";

/// The page's exclusive host for an origin and the submission its frame last ran.
interface ReviewState {
	host: RunnerHost;
	submission: string | null;
}

const states = new Map<string, ReviewState>();

/// Identifies the latest call; an earlier call that finds another value was superseded.
let latest = 0;

/// Tail of the queue of calls, so they are handled one at a time.
let queue: Promise<unknown> = Promise.resolve();

const STOPPED: RunExit = { reason: "stopped", code: null };

/// The handle of a call that never started a run.
function supersededHandle(): RunHandle {
	return {
		runId: "",
		sendLine: () => {},
		sendEof: () => {},
		stop: () => {},
		done: Promise.resolve(STOPPED),
	};
}

/**
 * Runs `request` as a run of `submission` on the page's review host.
 *
 * The page has one `RunnerHost.exclusive(runnerOrigin)`, created on first
 * use, so at most one run exists at a time: a new run stops the previous
 * one, whatever widget started it. When `submission` differs from the
 * submission of the previous run, the host is reloaded first
 * (`RunnerHost.reload()`), so no state of one student's code reaches the
 * next. Running the same submission again, original or modified copy, reuses
 * the frame; each run still gets a new Worker. After a reload, and on first
 * use, the language's reserve Worker is requested before the run, so the
 * frame keeps one for the next run of the same submission.
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
export function runForSubmission(
	runnerOrigin: string,
	submission: string,
	request: RunRequest,
	handlers: RunHandlers,
): Promise<RunHandle> {
	const mine = ++latest;
	const superseded = () => mine !== latest;
	const result = queue.then(async (): Promise<RunHandle> => {
		if (superseded()) return supersededHandle();
		const origin = new URL(runnerOrigin).origin;
		let state = states.get(origin);
		const fresh = state === undefined;
		if (!state) {
			state = { host: RunnerHost.exclusive(origin), submission: null };
			states.set(origin, state);
		}
		const changed =
			state.submission !== null && state.submission !== submission;
		state.submission = submission;
		if (changed) {
			await state.host.reload();
			if (superseded()) return supersededHandle();
		}
		if (fresh || changed) state.host.prepare(request.language);
		const guarded: RunHandlers = {
			onStatus: (value) => {
				if (!superseded()) handlers.onStatus?.(value);
			},
			onProgress: (loaded, total) => {
				if (!superseded()) handlers.onProgress?.(loaded, total);
			},
			onOutput: (stream, text) => {
				if (!superseded()) handlers.onOutput?.(stream, text);
			},
		};
		const handle = await state.host.run(request, guarded);
		if (superseded()) {
			handle.stop();
			return supersededHandle();
		}
		return handle;
	});
	queue = result.catch(() => {});
	return result;
}
