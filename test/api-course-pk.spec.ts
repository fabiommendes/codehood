import { expect, test } from "@playwright/test";
import { parseCourseParams } from "@/api/utils";

/**
 * `parseCourseParams` is the whole grammar of a course's REST address, and it
 * is pure, so it gets pinned here without a running server. The status codes
 * it produces over HTTP are covered in `api-crud.spec.ts`.
 */

test("splits a course segment into a coursePkRef", () => {
	expect(
		parseCourseParams({ discipline: "cs101", course: "ada_2026-1" }),
	).toEqual({
		ref: { discipline: "cs101", instructor: "ada", edition: "2026-1" },
	});
});

test("accepts an edition with no term number", () => {
	expect(
		parseCourseParams({ discipline: "algorithms", course: "hopper_2027" }),
	).toEqual({
		ref: { discipline: "algorithms", instructor: "hopper", edition: "2027" },
	});
});

// Editions cannot contain underscores, so splitting at the last one stays
// correct even if usernames are ever allowed to contain one.
test("splits at the last underscore", () => {
	expect(
		parseCourseParams({ discipline: "cs101", course: "ada_lovelace_2026-1" }),
	).toEqual({
		ref: {
			discipline: "cs101",
			instructor: "ada_lovelace",
			edition: "2026-1",
		},
	});
});

for (const course of [
	"noUnderscore",
	"ada_",
	"_2026-1",
	"ada_notayear",
	"ada_2026-01",
	"ada_26-1",
]) {
	test(`rejects "${course}" with a 400`, () => {
		let status: number | undefined;
		try {
			parseCourseParams({ discipline: "cs101", course });
		} catch (error) {
			status = (error as { status?: number }).status;
		}
		expect(status).toBe(400);
	});
}
