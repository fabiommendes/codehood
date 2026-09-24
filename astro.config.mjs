// @ts-check
import node from "@astrojs/node";
import solidJs from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, envField, logHandlers } from "astro/config";
import { dynamicRouterHook } from "@/api/registry/hook";

// https://astro.build/config
export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [solidJs(), dynamicRouterHook()],
	vite: {
		plugins: [tailwindcss()],
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
