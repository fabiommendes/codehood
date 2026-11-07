/**
 * Story of a student reading how a rubric graded their answer (spec
 * `dev/specs/to-do/rubrica-de-correcao.md`, R20 and R30). The view does not
 * exist yet; this file is the contract it is built to.
 *
 * UI contract of the attempt review at `/<discipline>/<course>/exams/<exam>`,
 * once the grades are released:
 *
 * - Under the answer graded with a rubric there is a `list "Rubric items"`,
 *   one `listitem` per applied item, in rubric order. Each shows the item
 *   text, its value as a signed whole percentage (`+60%`, `-10%`) and its
 *   student feedback when it has one.
 * - The instructor's free comment is shown after that list.
 * - Items that were not applied, and the private `comment` of any item, are
 *   not in the page at all.
 * - Before the release none of it is shown (the page already says the results
 *   are not out yet).
 */
import { expect, test } from "@playwright/test";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { createRubricScenario } from "@/fixtures/rubric-scenario";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase } from "./helpers";

test.beforeEach(resetDatabase);

test("student: see which rubric items shaped my grade", async ({ page }) => {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		items: [
			{
				key: "full",
				group: "Recursion/Correct",
				text: "Base case and step",
				value: "0.6",
				comment: "PRIVATE copied from the tutorial?",
				feedback: "Well structured recursion",
			},
			{
				key: "naming",
				text: "Clear naming",
				value: "0.2",
				comment: "PRIVATE names look rehearsed",
				feedback: "Names say what they hold",
			},
			{
				key: "off",
				text: "Off by one",
				value: "-0.1",
				comment: "PRIVATE unapplied note",
				feedback: "Unapplied check the loop bounds",
			},
			{
				key: "trick",
				group: "Recursion/Wrong",
				text: "Unused trick",
				value: "0.3",
				feedback: "Unapplied hint",
			},
		],
	});
	const answer = await s.addAnswer();
	await db.response.finish(
		{ course: s.course.id, exam: s.exam.slug },
		{ actor: answer.author },
	);
	const passId = await s.seedPass(answer, rubric, {
		ref: "pass-1",
		keys: ["full", "naming"],
		score: "0.8",
	});
	await prisma.feedback.update({
		where: { id: passId },
		data: { feedback: "Overall a solid attempt" },
	});
	await s.close();

	const course = await prisma.course.findUniqueOrThrow({
		where: { id: s.course.id },
	});
	const exam = `${courseHref({
		discipline: course.disciplineSlug,
		instructor: course.instructorId,
		edition: course.editionSlug,
	})}/exams/${s.exam.slug}`;
	await logInAs(page, answer.author);

	const hidden = [
		"Base case and step",
		"Well structured recursion",
		"Clear naming",
		"Overall a solid attempt",
	];

	await test.step("before the release none of the grading is shown", async () => {
		await page.goto(exam);

		await expect(page.getByText(/results are not out yet/i)).toBeVisible();
		await expect(page.getByRole("list", { name: "Rubric items" })).toHaveCount(
			0,
		);
		for (const text of hidden)
			await expect(page.getByText(text)).toHaveCount(0);
		await expect(page.getByText("80%")).toHaveCount(0);
	});

	await test.step("after the release the applied items show with value and feedback, then the free comment", async () => {
		await s.release();
		await page.reload();

		const applied = page
			.getByRole("list", { name: "Rubric items" })
			.getByRole("listitem");
		await expect(applied).toHaveCount(2);
		await expect(applied.nth(0)).toContainText("Base case and step");
		await expect(applied.nth(0)).toContainText("+60%");
		await expect(applied.nth(0)).toContainText("Well structured recursion");
		await expect(applied.nth(1)).toContainText("Clear naming");
		await expect(applied.nth(1)).toContainText("+20%");
		await expect(applied.nth(1)).toContainText("Names say what they hold");
		await expect(page.getByText("Overall a solid attempt")).toBeVisible();
		await expect(page.getByText("80%").first()).toBeVisible();

		const text = await page.getByRole("main").innerText();
		expect(text.indexOf("Names say what they hold")).toBeGreaterThan(-1);
		expect(text.indexOf("Overall a solid attempt")).toBeGreaterThan(
			text.indexOf("Names say what they hold"),
		);
	});

	await test.step("the instructor's private notes and the items that did not apply stay out of the page", async () => {
		const html = await page.content();

		expect(html).not.toContain("PRIVATE");
		for (const text of ["Off by one", "Unused trick", "Unapplied"]) {
			expect(html).not.toContain(text);
		}
	});
});
