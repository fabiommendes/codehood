/**
 * The runner harness bound to the test server of `runnerGlobalSetup`: the
 * frame comes from `RUNNER_ORIGIN`, hosted by the page at `APP_ORIGIN/`.
 */

import { APP_ORIGIN, RUNNER_ORIGIN } from "./env";
import { runnerHarness } from "./harness";

export type {
	Harness,
	Language,
	RunnerMessage,
	RunResult,
} from "./harness";
export { APP_ORIGIN, RUNNER_ORIGIN };

export const {
	loadFrame,
	send,
	start,
	run,
	allMessages,
	messagesOf,
	waitFor,
	collect,
	runMessage,
	statesOf,
} = runnerHarness({ appPage: `${APP_ORIGIN}/`, runnerOrigin: RUNNER_ORIGIN });
