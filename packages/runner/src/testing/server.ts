/**
 * A minimal server for the runner's own tests: no Astro, no database.
 *
 * One `node:http` server on a free port answers as two sites, like the dev
 * server of the app: `http://localhost:<port>` is the app, whose page hosts
 * the frame and exposes `RunnerHost` on `window.__runner`, and
 * `http://127.0.0.1:<port>` is the runner origin, served by `serveRunner`.
 */

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import type { RunnerPlugin } from "@codehood/runner-api";
import { build } from "esbuild";
import { pluginRuntimes } from "../registry";
import { runnerAssets } from "../server/assets";
import { serveRunner } from "../server/handler";
import { buildRunnerBundle } from "../server/integration";
import { APP_CSP, requestSide } from "../server/routing";

/** A running test server. */
export interface TestServer {
	appOrigin: string;
	runnerOrigin: string;
	close(): Promise<void>;
}

/// The page of the app side: loads `host.js`, nothing else.
const HOST_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>runner test host</title>
<script type="module" src="/host.js"></script></head>
<body></body>
</html>
`;

/// Bundles `host-page.ts`, which puts `RunnerHost` on `window.__runner`.
async function hostScript(): Promise<string> {
	const result = await build({
		entryPoints: [join(import.meta.dirname, "host-page.ts")],
		bundle: true,
		format: "esm",
		platform: "browser",
		target: "es2022",
		write: false,
		logLevel: "silent",
	});
	return result.outputFiles[0]?.text ?? "";
}

/// Turns a Node request into a fetch `Request` for `serveRunner`.
function toRequest(
	url: URL,
	headers: Record<string, string | string[] | undefined>,
): Request {
	const h = new Headers();
	for (const [key, value] of Object.entries(headers)) {
		if (value !== undefined) h.set(key, String(value));
	}
	return new Request(url, { headers: h });
}

/**
 * Builds a runner bundle with `plugins` (plus `fake`) into `bundleDir` and
 * serves it with a host page, on a free port.
 *
 * @param root project root the plugin specifiers are resolved from.
 */
export async function startTestServer({
	root,
	bundleDir,
	plugins,
	stdinGraceMs,
}: {
	root: string;
	bundleDir: string;
	plugins: readonly RunnerPlugin[];
	stdinGraceMs?: number;
}): Promise<TestServer> {
	await buildRunnerBundle(root, bundleDir, {
		minify: false,
		plugins,
		stdinGraceMs,
	});
	const script = await hostScript();
	const assets = runnerAssets(() => bundleDir, pluginRuntimes(plugins));
	let appOrigin = "";
	let runnerOrigin = "";

	const server: Server = createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
		const side = requestSide(url, runnerOrigin);
		let response: Response;
		if (side === "runner") {
			response = await serveRunner(toRequest(url, req.headers), {
				assets,
				appOrigin,
				development: true,
			});
		} else if (side === "app" && url.pathname === "/") {
			response = new Response(HOST_PAGE, {
				headers: {
					"Content-Type": "text/html; charset=utf-8",
					"Content-Security-Policy": APP_CSP,
				},
			});
		} else if (side === "app" && url.pathname === "/host.js") {
			response = new Response(script, {
				headers: { "Content-Type": "text/javascript; charset=utf-8" },
			});
		} else {
			response = new Response("Not found", { status: 404 });
		}
		res.writeHead(response.status, Object.fromEntries(response.headers));
		res.end(Buffer.from(await response.arrayBuffer()));
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	appOrigin = `http://localhost:${port}`;
	runnerOrigin = `http://127.0.0.1:${port}`;
	return {
		appOrigin,
		runnerOrigin,
		close: () =>
			new Promise((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			),
	};
}
