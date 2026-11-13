import {
	all,
	CORRECT,
	codeWorld,
	PARTIAL,
	type Verdicts,
} from "./code-grading-support";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase } from "./stories/helpers";

// The student's review of an exam lists the sends of a code question: the
// state and the score of each, its discount, and which one counts.

test.beforeEach(resetDatabase);

const partial: Verdicts = { ...all("pass"), negatives: "fail" };

test("the review lists the sends and marks the one that counts", async ({
	page,
}) => {
	const world = await codeWorld();
	const student = await world.student("review-student");
	await world.sendAndGrade(student, PARTIAL, partial);
	await world.sendAndGrade(student, CORRECT, all("pass"));
	await world.close([student]);

	await logInAs(page, student);
	await page.goto(world.href);

	const sends = page.locator("[data-sends][data-mode=review] [data-send]");
	await expect(sends).toHaveCount(2);
	await expect(sends.nth(0)).not.toHaveAttribute("data-counts", "true");
	await expect(sends.nth(0).locator("[data-send-score]")).toBeVisible();
	await expect(sends.nth(0).locator("[data-send-discounted]")).toHaveCount(0);
	await expect(sends.nth(1)).toHaveAttribute("data-counts", "true");
	await expect(sends.nth(1).locator("[data-send-counts]")).toBeVisible();
	await expect(sends.nth(1).locator("[data-send-score]")).toHaveText("Score 1");
	await expect(sends.nth(1).locator("[data-send-discounted]")).toHaveText(
		"With discount 0.8",
	);
	await expect(page.locator("[data-editor]")).toHaveCount(0);
	await expect(page.locator("[data-action=submit]")).toHaveCount(0);
});

test("a send that failed its pretest has no score and does not count", async ({
	page,
}) => {
	const world = await codeWorld();
	const student = await world.student("pretest-student");
	await world.sendAndGrade(student, "module Main exposing (soma)", {
		...all("pass"),
		one: "fail",
	});
	await world.sendAndGrade(student, CORRECT, all("pass"));
	await world.close([student]);

	await logInAs(page, student);
	await page.goto(world.href);

	const sends = page.locator("[data-sends][data-mode=review] [data-send]");
	await expect(sends).toHaveCount(2);
	await expect(sends.nth(0)).toContainText("A pretest failed");
	await expect(sends.nth(0).locator("[data-send-score]")).toHaveCount(0);
	await expect(sends.nth(0)).not.toHaveAttribute("data-counts", "true");
	await expect(sends.nth(1)).toHaveAttribute("data-counts", "true");
	// A send that failed a pretest costs no discount.
	await expect(sends.nth(1).locator("[data-send-discounted]")).toHaveCount(0);
});

test("a hidden case never reaches the student's page", async ({ page }) => {
	const world = await codeWorld();
	const student = await world.student("hidden-student");
	await world.sendAndGrade(student, PARTIAL, partial);
	await world.close([student]);

	await logInAs(page, student);
	await page.goto(world.href);

	const cases = page
		.locator("[data-send]")
		.first()
		.getByRole("list", { name: "Pretest results" })
		.getByRole("listitem");
	await expect(cases).toHaveCount(2);
	await expect(cases.nth(0)).toContainText("vazia");
	await expect(cases.nth(1)).toContainText("um");
});
