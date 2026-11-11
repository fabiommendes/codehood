// @ts-check

// Process settings (`ENVIRONMENT`, `CODEHOOD_CONFIG`) may live in `.env`; a
// variable already set in the environment wins.
import "dotenv/config";
import { fileURLToPath } from "node:url";
import node from "@astrojs/node";
import solidJs from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, logHandlers } from "astro/config";
import { dynamicRouterHook } from "@/api/registry/hook";
import { codehoodConfig, loadConfig } from "@/config/integration";
import { configPath } from "@/config/path";
import { resolveRunnerOrigin } from "@/runner/server/config";
import { runnerBundle } from "@/runner/server/integration";
import { localeDefine, paraglidePlugin } from "./scripts/lib/paraglide";

const root = fileURLToPath(new URL(".", import.meta.url));

/// The instance configuration (`codehood.config.ts`, or `CODEHOOD_CONFIG`).
const configFile = configPath(root, process.env);
const config = await loadConfig(configFile);

/// Public address of the instance. Behind a reverse proxy the server only
/// sees plain HTTP from 127.0.0.1, so it must trust the proxy's
/// `X-Forwarded-*` headers for this host; otherwise form posts fail the
/// origin check (`https://` page, `http://` request) and every client shares
/// the proxy's IP, which breaks the per-IP rate limits.
const publicUrl = new URL(config.instance.publicUrl);

/// Origin of the runner frame, resolved as the server does at runtime.
const environment = /^(prod|production)$/.test(process.env.ENVIRONMENT ?? "")
	? "prod"
	: "dev";
const runnerOrigin = resolveRunnerOrigin(
	config.runner.origin ?? undefined,
	publicUrl.origin,
	environment,
);

/// Hosts the server trusts `Host`/`X-Forwarded-Host` for: the app and the runner.
const allowedDomains = [publicUrl, runnerOrigin ? new URL(runnerOrigin) : null]
	.filter((url) => url !== null)
	.map((url) => ({
		protocol: url.protocol.slice(0, -1),
		hostname: url.hostname,
	}));

// https://astro.build/config
export default defineConfig({
	output: "server",
	site: publicUrl.origin,
	security: {
		// Off because Astro's check also refuses a form-typed POST that carries no
		// `Origin` header, which is every multipart upload from the CLI.
		// `originMiddleware` applies the same rule to everything but requests
		// authenticated by an API key.
		checkOrigin: false,
		// A report carries up to 3 images of 2 MiB each, plus room for the multipart framing.
		actionBodySizeLimit: 8 * 1024 * 1024,
		allowedDomains,
	},
	// A development instance answers on `localhost` and, for the runner origin,
	// on `127.0.0.1`: one address serves both names.
	server: environment === "dev" ? { host: "127.0.0.1" } : {},
	adapter: node({ mode: "standalone" }),
	integrations: [
		codehoodConfig(configFile, config),
		solidJs(),
		dynamicRouterHook(),
		runnerBundle(config.runner.languages),
	],
	vite: {
		plugins: [tailwindcss(), paraglidePlugin(root)],
		// Fixes the locale the build compiles for (`instance.locale`).
		define: localeDefine(root, config.instance.locale),
		// Sourcemaps let `pnpm coverage` (c8, run against the built webServer process)
		// map V8 coverage on the bundled output back to the original src/*.ts files.
		build: { sourcemap: !!process.env.COVERAGE },
		// `mdq` is linked from a sibling checkout as a dev dependency, so the
		// server bundle carries it and a production install never needs it.
		ssr: { noExternal: ["mdq"] },
		// The linked `mdq` has its own node_modules; one copy of each peer.
		resolve: { dedupe: ["zod", "solid-js"] },
		// Nothing under these is served by the dev server. `cli/` alone carries a
		// Python virtualenv of ~9k files, and walking it slowed every dev start.
		// `storage/` and the databases change at runtime and must not trigger reloads.
		server: {
			watch: {
				ignored: [
					"cli",
					"test/.tmp",
					"test-results",
					"playwright-report",
					"coverage",
					"dist",
					"storage",
					"deploy",
					".base-ast-cache",
					".claude",
					".impeccable",
				]
					.map((dir) => `${root}${dir}/**`)
					.concat(`${root}*.db*`, `${root}.idea/**`)
					// Dotfiles a sandboxed shell mounts over the project root. Listed
					// one by one so that `.env` changes still reach the watcher.
					.concat(
						[
							".bashrc",
							".bash_profile",
							".profile",
							".zshrc",
							".zprofile",
							".gitconfig",
							".gitmodules",
							".ripgreprc",
							".mcp.json",
						].map((file) => `${root}${file}`),
					),
			},
		},
	},
	logger: logHandlers.console({ level: "info" }),
});
