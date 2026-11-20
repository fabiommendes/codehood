import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { type Route, urls } from "@/urls";
import { urlPatternsModule } from "@/urls/integration";
import { discoverRoutes } from "./tour/routes";

/// Path prefixes whose every page and endpoint is in the registry, and that
/// no code outside {@link UNCHECKED_DIRS} writes as a literal.
const MIGRATED_PREFIXES = [
	"/admin",
	"/login",
	"/home",
	"/profile",
	"/getting-started",
	"/calendar",
	"/courses",
	"/invite",
	"/check-in",
	"/c",
	"/403",
	"/404",
	"/500",
];

/// Directories under `src/` the literal check skips: the registry itself, the
/// generated types, and the runner, whose `/home` is a directory of the
/// virtual file system a program runs in, not a page.
const UNCHECKED_DIRS = ["urls", "generated", "runner"];

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
		`["'\`}](${MIGRATED_PREFIXES.join("|")})(?=["'\`/?#$])`,
	);
	const offenders = sourceFiles("src")
		.filter(
			(file) =>
				!UNCHECKED_DIRS.some((dir) =>
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

test("a route fills its parameters from the pattern, encoded", () => {
	expect(urls.admin.reports()).toBe("/admin/reports");
	expect(urls.invite({ token: "a b/c" })).toBe("/invite/a%20b%2Fc");
	expect(urls.calendarFeed({ token: "t0k" })).toBe("/calendar/t0k.ics");
	expect(urls.rollCallCheckIn({ rollCallId: "7", code: "XY" })).toBe("/c/7/XY");
});

test("a route writes the query values that are set, true as 1", () => {
	expect(urls.login({ next: "/check-in" })).toBe("/login?next=%2Fcheck-in");
	expect(urls.login({ next: undefined })).toBe("/login");
	expect(urls.courses.index({ left: true })).toBe("/courses?left=1");
	expect(urls.courses.index({ left: false })).toBe("/courses");
	expect(urls.calendar({ month: "2026-11" })).toBe("/calendar?month=2026-11");
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
