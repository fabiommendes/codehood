import { expect, test } from "@playwright/test";
import { discoverRoutes, matchRoute, routeOf, routeSlug } from "./tour/routes";

test("routeOf turns a page file into its Astro route", () => {
	expect(routeOf("src/pages/index.astro")).toMatchObject({
		pattern: "/",
		kind: "page",
	});
	expect(
		routeOf("src/pages/[discipline]/[course]/exams/index.astro").pattern,
	).toBe("/[discipline]/[course]/exams");
	expect(routeOf("src/pages/files/[hash].ts").kind).toBe("endpoint");
});

test("matchRoute prefers a static segment to a parameter, and a parameter to a rest", () => {
	const routes = discoverRoutes();
	const match = (pathname: string) => matchRoute(routes, pathname)?.pattern;
	expect(match("/")).toBe("/");
	expect(match("/courses/join")).toBe("/courses/join");
	expect(match("/cs101/ada_2026-2")).toBe("/[discipline]/[course]");
	expect(match("/cs101/ada_2026-2/exams/quiz-01")).toBe(
		"/[discipline]/[course]/exams/[slug]",
	);
	expect(match("/cs101/ada_2026-2/repositories/lab.zip")).toBe(
		"/[discipline]/[course]/repositories/[slug].zip",
	);
	expect(match("/cs101/ada_2026-2/repositories/lab/src/a.py")).toBe(
		"/[discipline]/[course]/repositories/[slug]/[...path]",
	);
	expect(match("/cs101/ada_2026-2/repositories/lab")).toBe(
		"/[discipline]/[course]/repositories/[slug]/[...path]",
	);
	expect(match("/no/route/has/this/many/segments")).toBeUndefined();
});

test("discoverRoutes skips files and directories that start with an underscore", () => {
	const files = discoverRoutes().map((route) => route.file);
	expect(files.some((file) => /\/_/.test(file))).toBe(false);
	expect(files).toContain("src/pages/home.astro");
});

test("routeSlug names a route as a directory", () => {
	expect(routeSlug("/")).toBe("index");
	expect(routeSlug("/[discipline]/[course]/exams/[slug]")).toBe(
		"[discipline].[course].exams.[slug]",
	);
	expect(routeSlug("/runner/[...path]")).toBe("runner.[…path]");
});
