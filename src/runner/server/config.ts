/**
 * Server-side settings of the runner origin.
 */

/**
 * Resolves the origin the runner frame is served from.
 *
 * With `RUNNER_ORIGIN` set, returns its origin. Unset, a development instance
 * whose `publicUrl` host is `localhost` gets the same URL on `127.0.0.1`, and
 * the other way round, so app and runner are different sites on one process;
 * any other instance gets `null`, meaning code execution is off.
 *
 * @example
 * resolveRunnerOrigin(undefined, "http://localhost:4321", "dev"); // "http://127.0.0.1:4321"
 * resolveRunnerOrigin(undefined, "https://codehood.example", "prod"); // null
 *
 * @throws {Error} when `RUNNER_ORIGIN` is not an http(s) URL, has the same
 * origin as `publicUrl`, or is not https in production.
 */
export function resolveRunnerOrigin(
	_runnerOriginEnv: string | undefined,
	_publicUrl: string,
	_environment: "dev" | "prod",
): string | null {
	throw new Error("not implemented");
}
