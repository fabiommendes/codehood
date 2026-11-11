/**
 * Server-side settings of the runner origin.
 */

/**
 * Resolves the origin the runner frame is served from.
 *
 * With `runner.origin` set, returns its origin. Unset, a development instance
 * whose `publicUrl` host is `localhost` gets the same URL on `127.0.0.1`, and
 * the other way round, so app and runner are different sites on one process;
 * any other instance gets `null`, meaning code execution is off.
 *
 * @example
 * resolveRunnerOrigin(undefined, "http://localhost:4321", "dev"); // "http://127.0.0.1:4321"
 * resolveRunnerOrigin(undefined, "https://codehood.example", "prod"); // null
 *
 * @throws {Error} when `runner.origin` is not an http(s) URL, has the same
 * origin as `publicUrl`, or is not https in production.
 */
export function resolveRunnerOrigin(
	configured: string | undefined,
	publicUrl: string,
	environment: "dev" | "prod",
): string | null {
	const app = new URL(publicUrl);
	if (configured === undefined || configured.trim() === "") {
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
		url = new URL(configured.trim());
	} catch {
		throw new Error(`runner.origin is not a valid URL: "${configured}".`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(
			`runner.origin must be an http(s) URL, got "${configured}".`,
		);
	}
	if (url.origin === app.origin) {
		throw new Error(
			"runner.origin must differ from instance.publicUrl: the runner needs its own origin.",
		);
	}
	if (environment === "prod" && url.protocol !== "https:") {
		throw new Error("runner.origin must be https in production.");
	}
	return url.origin;
}
