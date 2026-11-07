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
	runnerOriginEnv: string | undefined,
	publicUrl: string,
	environment: "dev" | "prod",
): string | null {
	const app = new URL(publicUrl);
	if (runnerOriginEnv === undefined || runnerOriginEnv.trim() === "") {
		if (environment !== "dev") return null;
		const swap: Record<string, string> = {
			localhost: "127.0.0.1",
			"127.0.0.1": "localhost",
		};
		const host = swap[app.hostname];
		if (host === undefined) return null;
		const url = new URL(app.origin);
		url.hostname = host;
		return url.origin;
	}

	let url: URL;
	try {
		url = new URL(runnerOriginEnv.trim());
	} catch {
		throw new Error(`RUNNER_ORIGIN is not a valid URL: "${runnerOriginEnv}".`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(
			`RUNNER_ORIGIN must be an http(s) URL, got "${runnerOriginEnv}".`,
		);
	}
	if (url.origin === app.origin) {
		throw new Error(
			"RUNNER_ORIGIN must differ from PUBLIC_URL: the runner needs its own origin.",
		);
	}
	if (environment === "prod" && url.protocol !== "https:") {
		throw new Error("RUNNER_ORIGIN must be https in production.");
	}
	return url.origin;
}
