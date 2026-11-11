/**
 * The runner harness (`@codehood/runner/testing/harness`) bound to the test
 * server: the frame comes from `TEST_RUNNER_ORIGIN`, hosted by `/login`.
 */

import { runnerHarness } from "@codehood/runner/testing/harness";
import { TEST_RUNNER_ORIGIN } from "./env";

export type {
	Harness,
	Language,
	RunnerMessage,
	RunResult,
} from "@codehood/runner/testing/harness";

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
} = runnerHarness({ appPage: "/login", runnerOrigin: TEST_RUNNER_ORIGIN });
