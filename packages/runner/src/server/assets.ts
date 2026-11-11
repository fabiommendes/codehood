/**
 * Files of the sandbox bundle, as the runner endpoint serves them.
 *
 * The bundle is built by `runnerBundle()` (see `integration.ts`) outside
 * `public/`, because files there are served before the middleware runs, on
 * any host and without the runner headers.
 *
 * URL layout on the runner origin:
 *
 * | Path                         | Kind      | Content                          |
 * | :--------------------------- | :-------- | :------------------------------- |
 * | `/runner/frame`              | `frame`   | `RunnerAssets.framePage(...)`    |
 * | `/runner/sw.js`              | `sw`      | service worker                   |
 * | `/runner/<version>/<file>`   | `bundle`  | `frame.js`, `worker.js`, chunks  |
 * | `/runner/rt/<pkg>@<ver>/...` | `runtime` | files of the runner plugins      |
 */

import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type RuntimePackage, runtimePath } from "@codehood/runner-api/driver";
import type { FrameConfig } from "../sandbox/frame";
import { type ContentEncoding, MANIFEST_NAME, PRECOMPRESSED } from "./layout";
import type { RunnerAssetKind } from "./routing";

/// One file to serve; `encoding` is set when `body` is a compressed copy.
export interface RunnerAsset {
	kind: RunnerAssetKind;
	contentType: string;
	body: Uint8Array;
	encoding?: ContentEncoding;
}

/// Reads the current manifest; it is tiny and `astro dev` replaces it on rebuild.
function manifest(dir: string): {
	dir: string;
	version: string;
	files: Set<string>;
} {
	const data = JSON.parse(readFileSync(join(dir, MANIFEST_NAME), "utf8")) as {
		version: string;
		files: string[];
	};
	return { dir, version: data.version, files: new Set(data.files) };
}

const CONTENT_TYPES: Record<string, string> = {
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".zip": "application/zip",
	".json": "application/json",
	".data": "application/octet-stream",
	".wasm": "application/wasm",
	".map": "application/json",
};

/// Prefix of runtime files on the runner origin.
const RUNTIME_PREFIX = "/runner/rt/";

/// Content type from the file extension.
function contentType(name: string): string {
	return (
		CONTENT_TYPES[name.slice(name.lastIndexOf("."))] ??
		"application/octet-stream"
	);
}

/// Every runtime file of `runtimes`, as `<pkg>@<version>/<file>`.
function runtimeFiles(runtimes: readonly RuntimePackage[]): Set<string> {
	return new Set(
		runtimes.flatMap((runtime) =>
			Object.values(runtime.files).map((file) => runtimePath(runtime, file)),
		),
	);
}

/// Reads `path`, or the first of its compressed copies that `accepted`
/// allows and that exists.
async function readBody(
	path: string,
	accepted: (offered: readonly ContentEncoding[]) => ContentEncoding | null,
): Promise<Pick<RunnerAsset, "body" | "encoding">> {
	const copies = PRECOMPRESSED.filter(({ extension }) =>
		existsSync(path + extension),
	);
	const encoding = accepted(copies.map((copy) => copy.encoding));
	const copy = copies.find((c) => c.encoding === encoding);
	if (!copy) return { body: await readFile(path) };
	return {
		body: await readFile(path + copy.extension),
		encoding: copy.encoding,
	};
}

/// Escapes `value` for a double-quoted HTML attribute.
function escapeAttr(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/"/g, "&quot;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");
}

/** The files of one built bundle, as the runner endpoint serves them. */
export interface RunnerAssets {
	/** Content hash of the bundle; the `<version>` segment of its URLs. */
	version(): string;

	/**
	 * Resolves a path under `/runner/` to the file to serve.
	 *
	 * `accepted` picks, among the compressed copies that exist, the one to send
	 * (see `pickEncoding`); by default none is.
	 *
	 * @returns `null` for anything that is not a file of the current bundle,
	 * including another `<version>` and any path that escapes the bundle directory.
	 */
	read(
		pathname: string,
		accepted?: (offered: readonly ContentEncoding[]) => ContentEncoding | null,
	): Promise<RunnerAsset | null>;

	/**
	 * The frame page: an empty document whose `<meta>` tags carry the
	 * `FrameConfig` and whose only script is `/runner/<version>/frame.js`.
	 *
	 * Each key of the config is a `<meta name="runner:<key>">`; `bundleBase` is
	 * the path `/runner/<version>/`. No inline script, so the frame CSP needs no
	 * `'unsafe-inline'`.
	 */
	framePage(config: Omit<FrameConfig, "bundleBase">): string;
}

/**
 * The files of the bundle in `bundleDir()`, serving the runtime files of `runtimes`.
 *
 * `bundleDir` is called on every request: `astro dev` replaces the bundle on
 * rebuild, and the manifest is tiny.
 */
export function runnerAssets(
	bundleDir: () => string,
	runtimes: readonly RuntimePackage[],
): RunnerAssets {
	return {
		version: () => manifest(bundleDir()).version,
		async read(pathname, accepted = () => null) {
			const { dir, version, files } = manifest(bundleDir());
			let name: string;
			let kind: RunnerAssetKind;
			if (pathname.startsWith(RUNTIME_PREFIX)) {
				const rel = pathname.slice(RUNTIME_PREFIX.length);
				if (!runtimeFiles(runtimes).has(rel)) return null;
				return {
					kind: "runtime",
					contentType: contentType(rel),
					...(await readBody(join(dir, "rt", rel), accepted)),
				};
			}
			if (pathname === "/runner/sw.js") {
				name = "sw.js";
				kind = "sw";
			} else if (pathname.startsWith(`/runner/${version}/`)) {
				name = pathname.slice(`/runner/${version}/`.length);
				kind = "bundle";
				if (name === "sw.js") return null;
			} else {
				return null;
			}
			// Only names the build listed are served, so no path can leave the directory.
			if (!files.has(name)) return null;
			return {
				kind,
				contentType: contentType(name),
				...(await readBody(join(dir, name), accepted)),
			};
		},
		framePage(config) {
			const base = `/runner/${manifest(bundleDir()).version}/`;
			const metas = Object.entries({ ...config, bundleBase: base })
				.map(
					([key, value]) =>
						`<meta name="runner:${key}" content="${escapeAttr(String(value))}">`,
				)
				.join("\n");
			return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Codehood runner</title>
${metas}
<script type="module" src="${base}frame.js"></script>
</head>
<body></body>
</html>
`;
		},
	};
}
