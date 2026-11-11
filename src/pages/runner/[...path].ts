import { runtimes } from "codehood:runners";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerAssets } from "@codehood/runner/server/assets";
import { serveRunner } from "@codehood/runner/server/handler";
import {
	BUNDLE_DIR_NAME,
	DEV_BUNDLE_DIR,
	MANIFEST_NAME,
} from "@codehood/runner/server/layout";
import { requestSide } from "@codehood/runner/server/routing";
import type { APIRoute } from "astro";
import { PRODUCTION, PUBLIC_URL, RUNNER_ORIGIN } from "@/core/constants";

/// Bundle directory: the nearest `runner-bundle/` up from this module (the
/// server build keeps it next to `server/`), or the dev one under `.astro/`.
function bundleDir(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		for (const candidate of [BUNDLE_DIR_NAME, DEV_BUNDLE_DIR]) {
			const path = join(dir, candidate);
			if (existsSync(join(path, MANIFEST_NAME))) return path;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			throw new Error("Runner bundle not found; run the build first.");
		}
		dir = parent;
	}
}

const assets = runnerAssets(bundleDir, runtimes);

/// Serves the runner frame page and the sandbox bundle on the runner origin.
export const GET: APIRoute = async ({ url, request }) => {
	// The middleware already decided; checked again so a routing quirk cannot
	// expose the runner on the app origin.
	if (requestSide(url, RUNNER_ORIGIN) !== "runner") {
		return new Response("Not found", { status: 404 });
	}
	return serveRunner(request, {
		assets,
		appOrigin: PUBLIC_URL,
		development: !PRODUCTION,
	});
};
