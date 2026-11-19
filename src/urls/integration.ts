/**
 * Writes the `UrlPattern` type from the routes Astro resolves.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AstroIntegration, IntegrationResolvedRoute } from "astro";

/**
 * The source of `src/generated/url-patterns.ts` for `routes`: a union of the patterns of every route under `src/pages/`.
 *
 * @example
 * urlPatternsModule([{ pattern: "/admin", origin: "project" }]);
 * // '... export type UrlPattern =\n\t| "/admin";\n'
 */
export function urlPatternsModule(
	routes: readonly Pick<IntegrationResolvedRoute, "pattern" | "origin">[],
): string {
	const patterns = [
		...new Set(
			routes
				.filter((route) => route.origin === "project")
				.map((route) => route.pattern),
		),
	].sort();
	const union =
		patterns.length === 0
			? " never"
			: patterns.map((pattern) => `\n\t| ${JSON.stringify(pattern)}`).join("");
	return [
		"// Written by src/urls/integration.ts from the routes Astro resolves. Do not edit.",
		"",
		"/** The pattern of a page or endpoint under `src/pages/`, as Astro writes it. */",
		`export type UrlPattern =${union};`,
		"",
	].join("\n");
}

/**
 * Astro integration that keeps `src/generated/url-patterns.ts` in step with `src/pages/`.
 *
 * It runs whenever Astro resolves the routes: `astro sync`, `astro build`, and
 * `astro dev` each time a page is added or removed. The file is only written
 * when its content changes, so the dev server does not reload for nothing.
 */
export function urlPatterns(): AstroIntegration {
	let outFile = "";
	return {
		name: "codehood:url-patterns",
		hooks: {
			"astro:config:setup": ({ config }) => {
				outFile = path.join(
					fileURLToPath(config.srcDir),
					"generated",
					"url-patterns.ts",
				);
			},
			"astro:routes:resolved": ({ routes, logger }) => {
				const source = urlPatternsModule(routes);
				if (existsSync(outFile) && readFileSync(outFile, "utf8") === source)
					return;
				mkdirSync(path.dirname(outFile), { recursive: true });
				writeFileSync(outFile, source);
				logger.info(`wrote ${path.basename(outFile)}`);
			},
		},
	};
}
