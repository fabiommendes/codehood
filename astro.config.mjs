// @ts-check

// Build-time settings (`PUBLIC_URL`, `CODEHOOD_LOCALE`) may live in `.env`; a
// variable already set in the environment wins.
import "dotenv/config";
import { fileURLToPath } from "node:url";
import node from "@astrojs/node";
import solidJs from "@astrojs/solid-js";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, envField, logHandlers } from "astro/config";
import { dynamicRouterHook } from "@/api/registry/hook";
import { localeDefine, paraglideOptions } from "./scripts/lib/paraglide";

const root = fileURLToPath(new URL(".", import.meta.url));

/// Public address of a deployed instance, read at build time. Behind a reverse
/// proxy the server only sees plain HTTP from 127.0.0.1, so it must trust the
/// proxy's `X-Forwarded-*` headers for this host; otherwise form posts fail
/// the origin check (`https://` page, `http://` request) and every client
/// shares the proxy's IP, which breaks the per-IP rate limits.
const publicUrl = process.env.PUBLIC_URL
	? new URL(process.env.PUBLIC_URL)
	: null;

// https://astro.build/config
export default defineConfig({
	output: "server",
	site: publicUrl?.origin,
	security: {
		allowedDomains: publicUrl
			? [
					{
						protocol: publicUrl.protocol.slice(0, -1),
						hostname: publicUrl.hostname,
					},
				]
			: [],
	},
	adapter: node({ mode: "standalone" }),
	integrations: [solidJs(), dynamicRouterHook()],
	vite: {
		plugins: [tailwindcss(), paraglideVitePlugin(paraglideOptions(root))],
		// Fixes the locale the build compiles for (`CODEHOOD_LOCALE`).
		define: localeDefine(root, process.env),
		// Sourcemaps let `pnpm coverage` (c8, run against the built webServer process)
		// map V8 coverage on the bundled output back to the original src/*.ts files.
		build: { sourcemap: !!process.env.COVERAGE },
	},
	// `context: "client"` values are read the same way on the server and in the
	// browser (`astro:env/client`), which is what `SERVER_TZ` needs: it renders
	// both server-side (SSR) and inside hydrated islands (`ExamsTable`,
	// `QuestionsTable`), and both must agree. `access: "public"` follows from
	// that — a value read in the browser cannot be a secret.
	//
	// Deliberately named `SERVER_TZ`, not `TZ`: `TZ` is a Node-special variable
	// that also sets the process's own default time zone for anything that
	// doesn't pass an explicit `timeZone` (Prisma's own date handling, a stray
	// `toLocaleDateString()`, etc.), not just this module's formatting. Naming
	// this `TZ` would mean setting the app's display zone silently changes the
	// process's ambient one too, and vice versa. `SERVER_TZ` decouples the two:
	// only `src/utils/schedule-time.ts` reads it. The cost is that a deployment
	// already setting `TZ` for this purpose (the previous `process.env.TZ`
	// read) must add `SERVER_TZ` explicitly — it no longer has any effect here.
	env: {
		schema: {
			SERVER_TZ: envField.string({
				context: "client",
				access: "public",
				default: "America/Sao_Paulo",
			}),
		},
	},
	logger: logHandlers.console({ level: "info" }),
});
