import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { RUNTIMES, runtimeDir, runtimePath } from "@/runner/sandbox/runtimes";
import { buildRunnerBundle } from "@/runner/server/integration";
import { requestSide, runnerHeaders } from "@/runner/server/routing";
import { TEST_BASE_URL, TEST_RUNNER_ORIGIN } from "./env";

/// Fetches without cookies or redirects, as the frame's loader would.
async function get(origin: string, path: string) {
	return fetch(origin + path, { redirect: "manual" });
}

/// Status of a GET whose path is sent verbatim; `fetch` would fold `..` away.
function rawStatus(origin: string, path: string): Promise<number> {
	return new Promise((resolve, reject) => {
		const url = new URL(origin);
		const req = request(
			{ host: url.hostname, port: url.port, path, method: "GET" },
			(res) => {
				res.resume();
				resolve(res.statusCode ?? 0);
			},
		);
		req.on("error", reject);
		req.end();
	});
}

/// Version segment of the bundle, read from the frame page's script tag.
async function currentVersion(): Promise<string> {
	const html = await (await get(TEST_RUNNER_ORIGIN, "/runner/frame")).text();
	const match = html.match(/src="\/runner\/([0-9a-f]+)\/frame\.js"/);
	if (!match) throw new Error("frame page has no versioned script");
	return match[1] as string;
}

test.describe("runnerHeaders", () => {
	const app = "http://localhost:4321";

	test("every kind carries isolation, nosniff and the base CSP", () => {
		for (const kind of ["frame", "sw", "bundle", "runtime"] as const) {
			const headers = runnerHeaders(kind, app);
			expect(headers.get("Document-Isolation-Policy")).toBe(
				"isolate-and-credentialless",
			);
			expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
			const csp = headers.get("Content-Security-Policy") ?? "";
			for (const directive of [
				"default-src 'self'",
				"connect-src 'self'",
				"worker-src 'self'",
				"object-src 'none'",
				"base-uri 'none'",
				"form-action 'none'",
				`frame-ancestors ${app}`,
			]) {
				expect(csp.split("; ")).toContain(directive);
			}
		}
	});

	test("only bundle and runtime allow eval; frame and sw do not", () => {
		for (const kind of ["bundle", "runtime"] as const) {
			const csp = runnerHeaders(kind, app).get("Content-Security-Policy");
			expect(csp).toContain("'unsafe-eval'");
			expect(csp).toContain("'wasm-unsafe-eval'");
			expect(runnerHeaders(kind, app).get("Cache-Control")).toContain(
				"immutable",
			);
		}
		for (const kind of ["frame", "sw"] as const) {
			const headers = runnerHeaders(kind, app);
			expect(headers.get("Content-Security-Policy")).not.toContain(
				"unsafe-eval",
			);
			expect(headers.get("Cache-Control")).toBe("no-cache");
		}
	});
});

test.describe("requestSide with encoded paths", () => {
	test("encoded `/runner/` is not an app path", () => {
		for (const path of [
			"/%72unner/frame",
			"/runner%2Fframe",
			"/%2572unner/frame",
			"//runner/frame",
			"/%2Frunner/frame",
		]) {
			expect(
				requestSide(new URL(TEST_BASE_URL + path), TEST_RUNNER_ORIGIN),
			).toBe("not-found");
		}
	});
});

test.describe("frame page", () => {
	test("is served with the runner headers and no inline script", async () => {
		const response = await get(TEST_RUNNER_ORIGIN, "/runner/frame");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/html");
		expect(response.headers.get("cache-control")).toBe("no-cache");
		expect(response.headers.get("document-isolation-policy")).toBe(
			"isolate-and-credentialless",
		);
		const csp = response.headers.get("content-security-policy") ?? "";
		expect(csp).toContain(`frame-ancestors ${TEST_BASE_URL}`);
		expect(csp).not.toContain("unsafe-eval");

		const html = await response.text();
		const version = await currentVersion();
		expect(html).toContain(
			`<meta name="runner:appOrigin" content="${TEST_BASE_URL}">`,
		);
		expect(html).toContain(
			`<meta name="runner:bundleBase" content="/runner/${version}/">`,
		);
		expect(html).toContain('<meta name="runner:withFake" content="true">');
		expect(html).toContain('<meta name="runner:exclusive" content="false">');
		const scripts = [...html.matchAll(/<script\b([^>]*)>([^<]*)<\/script>/g)];
		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.[2]).toBe("");
		expect(scripts[0]?.[1]).toContain(`src="/runner/${version}/frame.js"`);
	});

	test("isolation=off drops the isolation policy", async () => {
		const response = await get(
			TEST_RUNNER_ORIGIN,
			"/runner/frame?isolation=off",
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("document-isolation-policy")).toBeNull();
	});

	test("exclusive=1 is carried in the meta tag", async () => {
		const html = await (
			await get(TEST_RUNNER_ORIGIN, "/runner/frame?exclusive=1")
		).text();
		expect(html).toContain('<meta name="runner:exclusive" content="true">');
	});

	test("is a 404 on the app origin, also when the path is encoded", async () => {
		for (const path of [
			"/runner/frame",
			"/%72unner/frame",
			"/%2572unner/frame",
		]) {
			expect((await get(TEST_BASE_URL, path)).status).toBe(404);
		}
	});
});

test.describe("bundle files", () => {
	test("worker.js is immutable JavaScript", async () => {
		const version = await currentVersion();
		const response = await get(
			TEST_RUNNER_ORIGIN,
			`/runner/${version}/worker.js`,
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/javascript");
		expect(response.headers.get("cache-control")).toContain("immutable");
		expect(response.headers.get("content-security-policy")).toContain(
			"'wasm-unsafe-eval'",
		);
	});

	test("another version and path escapes give 404", async () => {
		const version = await currentVersion();
		for (const path of [
			"/runner/000000000000/worker.js",
			`/runner/${version}/../../package.json`,
			`/runner/${version}/%2e%2e/%2e%2e/package.json`,
			`/runner/${version}/%2e%2e%2f%2e%2e%2fpackage.json`,
			`/runner/${version}/..%5cpackage.json`,
			`/runner/${version}/nothing.js`,
			`/runner/${version}/manifest.json`,
		]) {
			expect(await rawStatus(TEST_RUNNER_ORIGIN, path), path).toBe(404);
		}
	});

	test("sw.js is served unversioned with no-cache", async () => {
		const response = await get(TEST_RUNNER_ORIGIN, "/runner/sw.js");
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-cache");
		expect(response.headers.get("content-type")).toContain("text/javascript");
	});
});

test.describe("runtime files", () => {
	const rt = (path: string) => get(TEST_RUNNER_ORIGIN, `/runner/rt/${path}`);

	test("a listed file is served immutable with its content type", async () => {
		for (const [path, type] of [
			[runtimePath(RUNTIMES.swipl, "swipl-web.wasm"), "application/wasm"],
			[
				runtimePath(RUNTIMES.swipl, "swipl-web.data"),
				"application/octet-stream",
			],
			[runtimePath(RUNTIMES.pyodide, "pyodide.mjs"), "text/javascript"],
			[runtimePath(RUNTIMES.pyodide, "python_stdlib.zip"), "application/zip"],
			[runtimePath(RUNTIMES.pyodide, "pyodide-lock.json"), "application/json"],
			[runtimePath(RUNTIMES.wasmoon, "wasmoon.js"), "text/javascript"],
			[runtimePath(RUNTIMES.wasmoon, "glue.wasm"), "application/wasm"],
		] as const) {
			const response = await rt(path);
			expect(response.status, path).toBe(200);
			expect(response.headers.get("cache-control")).toContain("immutable");
			expect(response.headers.get("content-type")).toContain(type);
			await response.arrayBuffer();
		}
	});

	test("an unlisted file, another version and `..` are 404", async () => {
		const dir = runtimeDir(RUNTIMES.pyodide);
		for (const path of [
			`${dir}/package.json`,
			`${dir}/pyodide.mjs.map`,
			"pyodide@1.0.0/pyodide.mjs",
			`${dir}/../../manifest.json`,
			`${dir}/%2e%2e/%2e%2e/manifest.json`,
			"../manifest.json",
			`${dir}/..%2fmanifest.json`,
		]) {
			expect(
				await rawStatus(TEST_RUNNER_ORIGIN, `/runner/rt/${path}`),
				path,
			).toBe(404);
		}
	});

	test("the versions match the installed packages", () => {
		const declared = JSON.parse(readFileSync("package.json", "utf8"))
			.dependencies as Record<string, string>;
		for (const runtime of Object.values(RUNTIMES)) {
			const installed = JSON.parse(
				readFileSync(join("node_modules", runtime.pkg, "package.json"), "utf8"),
			);
			expect(installed.version).toBe(runtime.version);
			expect(declared[runtime.pkg]).toBe(runtime.version);
		}
	});

	test("swipl-web.js ends with the module export", async () => {
		const text = await (
			await rt(runtimePath(RUNTIMES.swipl, "swipl-web.js"))
		).text();
		expect(text.trimEnd().endsWith("export default SWIPL;")).toBe(true);
	});

	test("wasmoon.js is wrapped to export the UMD exports object", async () => {
		const text = await (
			await rt(runtimePath(RUNTIMES.wasmoon, "wasmoon.js"))
		).text();
		expect(text.startsWith("const exports = {}, module = {};")).toBe(true);
		expect(text.trimEnd().endsWith("export default exports;")).toBe(true);
	});
});

test.describe("bundle build", () => {
	test("an import outside the sandbox breaks the build", async () => {
		const root = mkdtempSync(join(tmpdir(), "runner-bundle-"));
		try {
			const entries = join(root, "src/runner/server/entries");
			mkdirSync(entries, { recursive: true });
			mkdirSync(join(root, "src/runner/sandbox"), { recursive: true });
			mkdirSync(join(root, "src/db"), { recursive: true });
			writeFileSync(join(root, "src/db/secret.ts"), "export const s = 1;");
			writeFileSync(
				join(root, "src/runner/sandbox/frame.ts"),
				'import { s } from "../../db/secret";\nexport const startFrame = () => s;',
			);
			writeFileSync(join(entries, "frame.ts"), 'import "../../sandbox/frame";');
			writeFileSync(join(entries, "worker.ts"), "export {};");
			writeFileSync(join(entries, "sw.ts"), "export {};");
			await expect(
				buildRunnerBundle(root, join(root, "out"), false),
			).rejects.toThrow(/may import only/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
