/**
 * Origins of the test server, set by `runnerGlobalSetup` before the workers start.
 */

function required(name: string): string {
	const value = process.env[name];
	if (!value)
		throw new Error(
			`${name} is unset; run through a config whose globalSetup calls runnerGlobalSetup.`,
		);
	return value;
}

/// The app side: the host page at `/`.
export const APP_ORIGIN = required("RUNNER_TEST_APP_ORIGIN");

/// The runner origin: `/runner/frame` and the bundle.
export const RUNNER_ORIGIN = required("RUNNER_TEST_RUNNER_ORIGIN");
