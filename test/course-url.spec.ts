import { expect, test } from "@playwright/test";
import {
	courseHref,
	DISCIPLINE_SLUG_RE,
	EDITION_RE,
	parseCourseSegment,
	RESERVED_SLUGS,
} from "@/utils/course-url";

test("parseCourseSegment round-trips with courseHref", () => {
	const ref = { disciplineSlug: "cs101", username: "ada", edition: "2026-1" };
	const href = courseHref(ref);
	expect(href).toBe("/cs101/ada_2026-1");

	const segment = href.split("/")[2];
	expect(parseCourseSegment(segment)).toEqual({
		username: "ada",
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
		username: "some_user",
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

test("RESERVED_SLUGS covers every top-level system route", () => {
	for (const slug of [
		"login",
		"design",
		"admin",
		"api",
		"courses",
		"profile",
	]) {
		expect(RESERVED_SLUGS.has(slug)).toBe(true);
	}
	expect(RESERVED_SLUGS.has("cs101")).toBe(false);
});
