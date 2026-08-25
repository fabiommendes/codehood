// @ts-check
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	vite: {
		plugins: [tailwindcss()],
	},
});
