import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { courseRoutes, type Route, urls, withAnchor, withSearch } from "@/urls";
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
	"/[discipline]/[course]",
	"/files",
	"/design",
];

/// The root of the course pages, whose paths start with parameters and are
/// checked by their static segments instead of by prefix.
const COURSE_ROOT = "/[discipline]/[course]";

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

const registry = [
	...registeredRoutes(urls),
	...registeredRoutes(courseRoutes, ["courseRoutes"]),
];
const pages = new Set(discoverRoutes().map((route) => route.pattern));

// Pages below `/design/playground/` are transient prototypes, linked through
// `playgroundPage()` from the listing of their folder.
test("every page under a migrated prefix is in the registry", () => {
	const registered = new Set<string>(
		registry.map(([, route]) => route.pattern),
	);
	const missing = [...pages].filter(
		(pattern) =>
			MIGRATED_PREFIXES.some((prefix) => underPrefix(pattern, prefix)) &&
			!pattern.startsWith("/design/playground/") &&
			!registered.has(pattern),
	);
	expect(missing).toEqual([]);
});

test("no code outside src/urls writes a migrated path as a literal", () => {
	const literal = new RegExp(
		`["'\`}](${MIGRATED_PREFIXES.filter((p) => !p.includes("[")).join("|")})(?=["'\`/?#$])`,
	);
	expect(offenders(literal)).toEqual([]);
});

/// The static segments of the course pages below the course itself:
/// `roster`, `exams`, `grading`, ...
const courseSegments = [
	...new Set(
		[...pages]
			.filter((pattern) => underPrefix(pattern, COURSE_ROOT))
			.flatMap((pattern) => pattern.slice(COURSE_ROOT.length).split("/"))
			.filter((segment) => segment !== "" && !segment.includes("[")),
	),
].sort();

// `src/api/` builds the paths of REST endpoints, whose segments (`preview`)
// share names with course pages.
test("no code outside src/urls appends a course page's segment to an interpolation", () => {
	expect(courseSegments).toContain("roster");
	const appended = new RegExp(
		`\\$\\{[^}]*\\}/(${courseSegments.join("|")})(?=["'\`/?#$]|$)`,
	);
	expect(offenders(appended, ["api"])).toEqual([]);
});

/// The components that render `<a>`; everything else renders them.
const LINK_COMPONENTS = [
	path.join("src", "components", "Link.astro"),
	path.join("src", "components", "Link.tsx"),
];

test("no markup outside the Link components writes an <a>", () => {
	const anchorTag = /<a(\s|>|$)/;
	const found = offenders(anchorTag).filter(
		(line) =>
			!LINK_COMPONENTS.some((file) => line.startsWith(`${file}:`)) &&
			/\.(astro|tsx):/.test(line),
	);
	expect(found).toEqual([]);
});

/// Each line of `src/` outside {@link UNCHECKED_DIRS} and `skip` that matches
/// `pattern`, comments left out.
function offenders(pattern: RegExp, skip: string[] = []): string[] {
	return sourceFiles("src")
		.filter(
			(file) =>
				![...UNCHECKED_DIRS, ...skip].some((dir) =>
					file.startsWith(`src${path.sep}${dir}${path.sep}`),
				),
		)
		.flatMap((file) =>
			readFileSync(file, "utf8")
				.split("\n")
				.map((line, index) => ({ line, at: `${file}:${index + 1}` }))
				.filter(({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line))
				.filter(({ line }) => pattern.test(line))
				.map(({ at, line }) => `${at}  ${line.trim()}`),
		);
}

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

test("a course's URLs take its reference and the slugs below it", () => {
	const course = urls.course({
		discipline: "cs101",
		instructor: "ana",
		edition: "2026-1",
	});
	expect(course.index()).toBe("/cs101/ana_2026-1");
	expect(course.index({ joined: true })).toBe("/cs101/ana_2026-1?joined=1");
	expect(course.resource("a b")).toBe("/cs101/ana_2026-1/resources/a%20b");
	expect(course.rollCall(3, "mon-08")).toBe(
		"/cs101/ana_2026-1/roll-call/3/mon-08",
	);
	expect(course.repository("r")).toBe("/cs101/ana_2026-1/repositories/r");
	expect(course.repository("r", ["src", "a b.py"], { rotate: true })).toBe(
		"/cs101/ana_2026-1/repositories/r/src/a%20b.py?rotate=1",
	);
	expect(course.repositoryZip("r")).toBe(
		"/cs101/ana_2026-1/repositories/r.zip",
	);
	expect(course.exam("p1").attempt("bob")).toBe(
		"/cs101/ana_2026-1/exams/p1/attempts/bob",
	);
	expect(
		course.exam("p1").gradingQuestion("q1", { view: "list", names: true }),
	).toBe("/cs101/ana_2026-1/exams/p1/grading/q1?view=list&names=1");
});

test("an anchor or a search keeps a URL of the registry", () => {
	expect(withAnchor(urls.home(), "event-4")).toBe("/home#event-4");
	expect(withSearch(urls.home(), "?a=1")).toBe("/home?a=1");
	expect(withSearch(urls.home(), new URLSearchParams())).toBe("/home");
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
