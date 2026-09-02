import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Matches `export const name = GET("/api/foo", { ... }` (and POST/PUT/DELETE/PATCH).
// Regex-based on purpose: this only has to handle the shape every route in
// src/api/*.ts is written in, not arbitrary JS.
const ROUTE_RE =
	/export\s+const\s+(\w+)\s*=\s*(GET|POST|PUT|DELETE|PATCH)\(\s*["'`]([^"'`]+)["'`]\s*,\s*\{/g;

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const apiDir = path.join(rootDir, "src", "api");
const outPath = path.join(apiDir, "registry", "route-patterns.json");

type RoutePattern = {
	name: string;
	method: string;
	pattern: string;
	file: string;
};

function findRoutes(fileName: string): RoutePattern[] {
	const source = readFileSync(path.join(apiDir, fileName), "utf8");
	const routes: RoutePattern[] = [];
	for (const match of source.matchAll(ROUTE_RE)) {
		const [, name, method, pattern] = match;
		routes.push({
			name,
			method: method.toLowerCase(),
			pattern,
			file: fileName,
		});
	}
	return routes;
}

const apiFiles = readdirSync(apiDir, { withFileTypes: true })
	.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
	.map((entry) => entry.name);

const routes = apiFiles
	.flatMap(findRoutes)
	.sort(
		(a, b) =>
			a.pattern.localeCompare(b.pattern) || a.method.localeCompare(b.method),
	);

writeFileSync(outPath, `${JSON.stringify(routes, null, 2)}\n`);
console.log(
	`Wrote ${path.relative(rootDir, outPath)} (${routes.length} routes)`,
);
