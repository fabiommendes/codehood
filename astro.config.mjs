// @ts-check
import node from "@astrojs/node";
import solidJs from "@astrojs/solid-js";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, logHandlers } from "astro/config";
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
	logger: logHandlers.console({ level: "info" }),
});
