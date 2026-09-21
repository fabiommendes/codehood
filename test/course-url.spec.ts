import { readdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
	courseHref,
	DISCIPLINE_SLUG_RE,
	EDITION_RE,
	parseCourseSegment,
	RESERVED_SLUGS,
} from "@/urls";

test("parseCourseSegment round-trips with courseHref", () => {
	const ref = { discipline: "cs101", instructor: "ada", edition: "2026-1" };
	const href = courseHref(ref);
	expect(href).toBe("/cs101/ada_2026-1");

	const segment = href.split("/")[2];
	if (!segment) throw new Error("expected a course segment");
	expect(parseCourseSegment(segment)).toEqual({
		instructor: "ada",
		edition: "2026-1",
	});
});

test("parseCourseSegment rejects a segment with no underscore", () => {
	expect(parseCourseSegment("ada2026")).toBeNull();
});

test("parseCourseSegment rejects a bad edition", () => {
	expect(parseCourseSegment("ada_not-a-year")).toBeNull();
	expect(parseCourseSegment("ada_")).toBeNull();
});

test("parseCourseSegment rejects a leading-zero term number", () => {
	expect(parseCourseSegment("ada_2026-01")).toBeNull();
	expect(parseCourseSegment("ada_2026-1")).not.toBeNull();
	expect(parseCourseSegment("ada_2026-0")).not.toBeNull();
	expect(parseCourseSegment("ada_2026")).not.toBeNull();
});

test("parseCourseSegment splits at the last underscore", () => {
	expect(parseCourseSegment("some_user_2026-1")).toEqual({
		instructor: "some_user",
		edition: "2026-1",
	});
});

test("EDITION_RE matches a year alone or a year-term pair", () => {
	expect(EDITION_RE.test("2026")).toBe(true);
	expect(EDITION_RE.test("2026-1")).toBe(true);
	expect(EDITION_RE.test("2026-2")).toBe(true);
	expect(EDITION_RE.test("2026-0")).toBe(true);
	expect(EDITION_RE.test("2026-01")).toBe(false);
	expect(EDITION_RE.test("26")).toBe(false);
});

test("DISCIPLINE_SLUG_RE requires a letter start and no trailing hyphen", () => {
	expect(DISCIPLINE_SLUG_RE.test("cs101")).toBe(true);
	expect(DISCIPLINE_SLUG_RE.test("algorithms")).toBe(true);
	expect(DISCIPLINE_SLUG_RE.test("1cs")).toBe(false);
	expect(DISCIPLINE_SLUG_RE.test("cs-")).toBe(false);
	expect(DISCIPLINE_SLUG_RE.test("C")).toBe(false);
});

// Read from the filesystem rather than a hand-written list: a top-level route
// added without reserving its name makes every course under a discipline of
// that name unreachable, and Astro reports nothing.
test("RESERVED_SLUGS covers every top-level system route", () => {
	const routes = readdirSync("src/pages", { withFileTypes: true })
		.map((entry) => entry.name.replace(/\.(astro|ts|js)$/, ""))
		.filter((name) => name !== "index" && DISCIPLINE_SLUG_RE.test(name));

	expect(routes.length).toBeGreaterThan(5);
	for (const slug of routes) {
		expect(
			RESERVED_SLUGS.has(slug),
			`/${slug} is routed but not in RESERVED_SLUGS`,
		).toBe(true);
	}
	expect(RESERVED_SLUGS.has("cs101")).toBe(false);
});
