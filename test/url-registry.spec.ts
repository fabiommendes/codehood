import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type Route, urls } from "@/urls";
import { urlPatternsModule } from "@/urls/integration";
import { discoverRoutes } from "./tour/routes";

/// Path prefixes whose every page and endpoint is in the registry, and that
/// no code outside `src/urls/` (and the generated types) writes as a string literal.
const MIGRATED_PREFIXES = ["/admin"];

function registeredRoutes(node: unknown, at: string[] = []): [string, Route][] {
	if (typeof node === "function" && "pattern" in node) {
		return [[at.join("."), node as Route]];
	}
	if (typeof node !== "object" || node === null) return [];
	return Object.entries(node).flatMap(([key, child]) =>
		registeredRoutes(child, [...at, key]),
	);
}

function underPrefix(pattern: string, prefix: string): boolean {
	return pattern === prefix || pattern.startsWith(`${prefix}/`);
}

function sourceFiles(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) return sourceFiles(full);
		return /\.(ts|tsx|astro)$/.test(entry.name) ? [full] : [];
	});
}

const registry = registeredRoutes(urls);
const pages = new Set(discoverRoutes().map((route) => route.pattern));

test("every page under a migrated prefix is in the registry", () => {
	const registered = new Set<string>(
		registry.map(([, route]) => route.pattern),
	);
	const missing = [...pages].filter(
		(pattern) =>
			MIGRATED_PREFIXES.some((prefix) => underPrefix(pattern, prefix)) &&
			!registered.has(pattern),
	);
	expect(missing).toEqual([]);
});

test("no code outside src/urls writes a migrated path as a literal", () => {
	const literal = new RegExp(
		`["'\`](${MIGRATED_PREFIXES.join("|")})(?=["'\`/?#$])`,
	);
	const offenders = sourceFiles("src")
		.filter(
			(file) =>
				!["urls", "generated"].some((dir) =>
					file.startsWith(`src${path.sep}${dir}${path.sep}`),
				),
		)
		.flatMap((file) =>
			readFileSync(file, "utf8")
				.split("\n")
				.map((line, index) => ({ line, at: `${file}:${index + 1}` }))
				.filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
				.filter(({ line }) => literal.test(line))
				.map(({ at, line }) => `${at}  ${line.trim()}`),
		);
	expect(offenders).toEqual([]);
});

test("a static route builds its own pattern", () => {
	expect(urls.admin.index()).toBe("/admin");
	expect(urls.admin.reports()).toBe("/admin/reports");
});

test("the UrlPattern union keeps the project's routes, sorted and once each", () => {
	const source = urlPatternsModule([
		{ pattern: "/admin/users", origin: "project" },
		{ pattern: "/_image", origin: "internal" },
		{ pattern: "/admin", origin: "project" },
		{ pattern: "/admin", origin: "project" },
	]);
	expect(source).toContain(
		'export type UrlPattern =\n\t| "/admin"\n\t| "/admin/users";',
	);
	expect(urlPatternsModule([])).toContain("export type UrlPattern = never;");
});
