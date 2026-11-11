/**
 * Stories of grading one question against a rubric (spec
 * `dev/specs/to-do/rubrica-de-correcao.md`, R23 to R29). The screens do not
 * exist yet; this file is the contract they are built to. Texts are the English
 * ones. Anything not listed here is free for the implementer to choose.
 *
 * UI contract of `grading/<question>` (all names are accessible names):
 *
 * - `region "Progress"` holds the texts `Answer {i} of {n}` (position in the
 *   order pending, to review, graded), `{n} pending` and `{n} to review`. The
 *   two counts are always shown, zero included.
 * - `region "Answer"` shows the student's answer text.
 * - `region "Rubric"` is the panel. A top-level group is a `radiogroup` named
 *   after the group, its leaves are `radio`s named after the item text. A loose
 *   item is a `checkbox` named after the item text. Each digit or letter
 *   shortcut is exposed as `aria-keyshortcuts` on the radiogroup, the checkbox
 *   or the radio (`"1"`, `"2"`, `"a"`, `"b"`...). A new item gets its own
 *   shortcut. Items start checked as the answer's current grade says.
 * - `textbox "Adjustment"` (a decimal such as `0.05`), `textbox "Comment"` (the
 *   free comment), `button "Save and next"`.
 * - `status "Score"` shows the live score as a whole percentage (`80%`).
 * - Shortcuts are off while focus is in a text field; `Enter` outside a field
 *   saves and moves to the next pending answer, `Enter` in a field does not
 *   save. `j` and `k` go to the next and the previous answer of the order.
 * - `n` opens `group "New item"` with `textbox "Text"`, `textbox "Value"` and
 *   `button "Add item"`. A refused submission shows an element with
 *   `role="alert"` and keeps the form open; `Escape` closes the form. A created
 *   item is applied to the current answer, not saved until the answer is.
 * - `?view=list` lists every answer as an `article` with the applied items, the
 *   score as a percentage and the free comment.
 */

import { db } from "@/db";
import { prisma } from "@/db/client";
import {
	createRubricScenario,
	type RubricScenario,
	type ScenarioAnswer,
} from "@/fixtures/rubric-scenario";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "../fixtures";
import { logInAs, resetDatabase } from "./helpers";

test.beforeEach(resetDatabase);

const MINUTE = 60_000;

/// Submissions are stamped relative to this, so their order does not depend on how fast the arrange steps ran.
const T0 = new Date("2026-03-10T10:00:00Z");

/// The URL of the exam's grading queue.
async function gradingUrl(scenario: RubricScenario): Promise<string> {
	const course = await prisma.course.findUniqueOrThrow({
		where: { id: scenario.course.id },
	});
	return `${courseHref({
		discipline: course.disciplineSlug,
		instructor: course.instructorId,
		edition: course.editionSlug,
	})}/exams/${scenario.exam.slug}/grading`;
}

/// A finished answer typed `text` at minute `minute` of the exam.
async function answerAt(
	scenario: RubricScenario,
	text: string,
	minute: number,
): Promise<ScenarioAnswer> {
	const answer = await scenario.addAnswer();
	await prisma.submission.update({
		where: { id: answer.submission.id },
		data: {
			payload: text,
			createdAt: new Date(T0.getTime() + minute * MINUTE),
		},
	});
	await db.response.finish(
		{ course: scenario.course.id, exam: scenario.exam.slug },
		{ actor: answer.author },
	);
	return answer;
}

/// Presses the shortcut an element advertises.
async function pressShortcutOf(
	page: Page,
	element: ReturnType<Page["getByRole"]>,
) {
	const key = await element.getAttribute("aria-keyshortcuts");
	expect(key, "the element advertises its shortcut").toBeTruthy();
	await page.keyboard.press(key as string);
}

test("instructor: grade an exam question with a rubric", async ({ page }) => {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		items: [
			{
				key: "full",
				group: "Recursion/Correct",
				text: "Base case and step",
				value: "0.6",
			},
			{
				key: "nobase",
				group: "Recursion/Wrong",
				text: "Missing base case",
				value: "0.3",
			},
			{
				key: "none",
				group: "Recursion/Wrong",
				text: "No recursion",
				value: "0",
			},
			{ key: "naming", text: "Clear naming", value: "0.2" },
			{ key: "off", text: "Off by one", value: "-0.1" },
			{ key: "old", text: "Old rule", value: "0.1", retired: true },
		],
	});
	const alpha1 = await answerAt(s, "Alpha solution", 1);
	await answerAt(s, "Beta solution", 2);
	await answerAt(s, "Alpha   solution ", 3);
	await answerAt(s, "Gamma solution", 4);
	// One answer still on a retired item and one done, to fill the other blocks.
	const epsilon = await answerAt(s, "Epsilon solution", 5);
	const delta = await answerAt(s, "Delta solution", 6);
	await s.close();
	await s.seedPass(epsilon, rubric, {
		ref: "pass-1",
		keys: ["old"],
		score: "0.1",
	});
	await s.seedPass(delta, rubric, {
		ref: "pass-1",
		keys: ["naming"],
		score: "0.2",
	});

	const grading = await gradingUrl(s);
	await logInAs(page, s.instructor);

	const progress = page.getByRole("region", { name: "Progress" });
	const answer = page.getByRole("region", { name: "Answer", exact: true });
	const rubricPanel = page.getByRole("region", { name: "Rubric", exact: true });
	const score = page.getByRole("status", { name: "Score" });
	const comment = page.getByRole("textbox", { name: "Comment" });
	const heading = page.getByRole("heading", { level: 2 });
	const checkedRadios = rubricPanel.getByRole("radio", { checked: true });
	const naming = rubricPanel.getByRole("checkbox", { name: "Clear naming" });
	const off = rubricPanel.getByRole("checkbox", { name: "Off by one" });
	const full = rubricPanel.getByRole("radio", { name: "Base case and step" });
	const nobase = rubricPanel.getByRole("radio", { name: "Missing base case" });

	await test.step("the question opens on its first pending answer, identical answers side by side", async () => {
		await page.goto(`${grading}/${s.main.slug}`);

		await expect(progress).toContainText("Answer 1 of 6");
		await expect(progress).toContainText("4 pending");
		await expect(progress).toContainText("1 to review");
		await expect(answer).toContainText("Alpha solution");

		// Pending first, then to review, then graded; the two Alphas are adjacent.
		const order = ["Alpha", "Alpha", "Beta", "Gamma", "Epsilon", "Delta"];
		for (const [i, word] of order.entries()) {
			await expect(answer).toContainText(`${word} solution`);
			await expect(progress).toContainText(`Answer ${i + 1} of 6`);
			await page.keyboard.press("j");
		}
		for (let i = 0; i < order.length; i++) await page.keyboard.press("k");
		await expect(progress).toContainText("Answer 1 of 6");
		await expect(answer).toContainText("Alpha solution");
	});

	await test.step("the shortcuts are advertised by the rubric panel", async () => {
		await expect(
			rubricPanel.getByRole("radiogroup", { name: "Recursion" }),
		).toHaveAttribute("aria-keyshortcuts", "1");
		await expect(full).toHaveAttribute("aria-keyshortcuts", "a");
		await expect(nobase).toHaveAttribute("aria-keyshortcuts", "b");
		await expect(naming).toHaveAttribute("aria-keyshortcuts", "2");
		await expect(off).toHaveAttribute("aria-keyshortcuts", "3");
	});

	await test.step("typing in the comment field fires no shortcut, and Enter there saves nothing", async () => {
		await comment.click();
		await page.keyboard.type("1a3njke?");

		await expect(comment).toHaveValue("1a3njke?");
		await expect(checkedRadios).toHaveCount(0);
		await expect(
			rubricPanel.getByRole("checkbox", { checked: true }),
		).toHaveCount(0);
		await expect(score).toHaveText("0%");
		await expect(page.getByRole("group", { name: "New item" })).toHaveCount(0);
		await expect(progress).toContainText("Answer 1 of 6");
		await expect(answer).toContainText("Alpha solution");

		await page.keyboard.press("Enter");

		await expect(progress).toContainText("Answer 1 of 6");
		await expect(progress).toContainText("4 pending");
		expect(
			await prisma.feedback.count({
				where: { submissionId: alpha1.submission.id },
			}),
		).toBe(0);
		await comment.fill("");
	});

	await test.step("a new item needs a text and a number", async () => {
		await heading.click();
		await page.keyboard.press("n");
		const form = page.getByRole("group", { name: "New item" });
		await expect(form).toBeVisible();

		await form.getByRole("button", { name: "Add item" }).click();
		await expect(form.getByRole("alert")).toBeVisible();

		await form.getByRole("textbox", { name: "Text" }).fill("Edge case handled");
		await form.getByRole("textbox", { name: "Value" }).fill("lots");
		await form.getByRole("button", { name: "Add item" }).click();
		await expect(form.getByRole("alert")).toBeVisible();

		await page.keyboard.press("Escape");
		await expect(form).toHaveCount(0);
		await expect(
			rubricPanel.getByRole("checkbox", { name: "Edge case handled" }),
		).toHaveCount(0);
	});

	await test.step("digits and letters grade the first answer, the score follows, n adds an item to it", async () => {
		await heading.click();
		await page.keyboard.press("1");
		await page.keyboard.press("a");
		await expect(full).toBeChecked();
		await expect(score).toHaveText("60%");

		// A letter replaces the option: one choice per group.
		await page.keyboard.press("1");
		await page.keyboard.press("b");
		await expect(nobase).toBeChecked();
		await expect(full).not.toBeChecked();
		await expect(score).toHaveText("30%");
		await page.keyboard.press("1");
		await page.keyboard.press("a");
		await expect(full).toBeChecked();

		await page.keyboard.press("2");
		await expect(naming).toBeChecked();
		await expect(score).toHaveText("80%");
		await page.keyboard.press("3");
		await expect(off).toBeChecked();
		await expect(score).toHaveText("70%");
		await page.keyboard.press("3");
		await expect(off).not.toBeChecked();
		await expect(score).toHaveText("80%");

		await page.keyboard.press("n");
		const form = page.getByRole("group", { name: "New item" });
		await form.getByRole("textbox", { name: "Text" }).fill("Edge case handled");
		await form.getByRole("textbox", { name: "Value" }).fill("0.1");
		await form.getByRole("button", { name: "Add item" }).click();

		const edge = rubricPanel.getByRole("checkbox", {
			name: "Edge case handled",
		});
		await expect(edge).toBeChecked();
		await expect(score).toHaveText("90%");
	});

	await test.step("Enter saves with the free comment and opens the next pending answer, an Alpha again", async () => {
		await comment.fill("Clean recursion");
		await heading.click();
		await page.keyboard.press("Enter");

		await expect(progress).toContainText("3 pending");
		await expect(answer).toContainText("Alpha solution");
		await expect(checkedRadios).toHaveCount(0);
		await expect(naming).not.toBeChecked();
		// The item made on the first answer is on offer here, unchecked.
		const edge = rubricPanel.getByRole("checkbox", {
			name: "Edge case handled",
		});
		await expect(edge).not.toBeChecked();

		const saved = await prisma.feedback.findFirstOrThrow({
			where: { submissionId: alpha1.submission.id },
		});
		expect(saved.score).toBe("0.9");
		expect(saved.feedback).toBe("Clean recursion");
	});

	await test.step("the second Alpha is graded with the new item, again by Enter", async () => {
		await page.keyboard.press("1");
		await page.keyboard.press("a");
		await pressShortcutOf(
			page,
			rubricPanel.getByRole("checkbox", { name: "Edge case handled" }),
		);
		await expect(score).toHaveText("70%");
		await page.keyboard.press("Enter");

		await expect(progress).toContainText("2 pending");
		await expect(answer).toContainText("Beta solution");
	});

	await test.step("the button saves too, with an adjustment", async () => {
		await page.keyboard.press("1");
		await page.keyboard.press("b");
		await page.keyboard.press("2");
		await page.getByRole("textbox", { name: "Adjustment" }).fill("0.05");
		await expect(score).toHaveText("55%");
		await comment.fill("Good structure");
		await page.getByRole("button", { name: "Save and next" }).click();

		await expect(progress).toContainText("1 pending");
		await expect(progress).toContainText("1 to review");
		await expect(answer).toContainText("Gamma solution");
		const beta = await prisma.feedback.findFirstOrThrow({
			where: { submission: { payload: { equals: "Beta solution" } } },
		});
		expect(beta.score).toBe("0.55");
		expect(beta.adjustment).toBe("0.05");
	});

	await test.step("the list view still lists every answer with the items applied", async () => {
		await page.goto(`${grading}/${s.main.slug}?view=list`);

		await expect(page.getByRole("article")).toHaveCount(6);
		const beta = page.getByRole("article").filter({ hasText: "Beta solution" });
		await expect(beta).toContainText("Missing base case");
		await expect(beta).toContainText("Clear naming");
		await expect(beta).toContainText("Good structure");
		await expect(beta).toContainText("55%");
		const alphas = page
			.getByRole("article")
			.filter({ hasText: "Alpha solution" });
		await expect(alphas).toHaveCount(2);
		await expect(alphas.first()).toContainText("Base case and step");
	});
});

test("instructor: change the rubric while grading", async ({ page }) => {
	const s = await createRubricScenario();
	const rubric = await s.seedRubric({
		items: [
			{ key: "works", group: "Correctness", text: "Works", value: "0.6" },
			{
				key: "wrong",
				group: "Correctness",
				text: "Wrong approach",
				value: "0.1",
			},
			{ key: "style", text: "Style", value: "0.4" },
		],
	});
	await answerAt(s, "Pending answer", 1);
	const first = await answerAt(s, "First graded", 2);
	const second = await answerAt(s, "Second graded", 3);
	await s.seedPass(first, rubric, {
		ref: "pass-1",
		keys: ["works", "style"],
		score: "1",
	});
	await s.seedPass(second, rubric, {
		ref: "pass-1",
		keys: ["works"],
		score: "0.6",
	});
	await s.close();

	const grading = await gradingUrl(s);
	await logInAs(page, s.instructor);

	/**
	 * Further contract, `grading/<question>` in edit mode (`e` toggles it, as
	 * does `button "Edit rubric"` and `button "Done editing"`):
	 *
	 * - `textbox "Base"`, and a `list "Rubric items"` whose `listitem`s each hold
	 *   the item text, `textbox "Value"`, `button "Split"` and `button "Delete"`.
	 * - `button "Apply changes"` writes the pending edits. When they change any
	 *   score, an element with `role="alert"` first reads `Changes the score of
	 *   {n} answers, {m} already released.` with `button "Confirm"` and `button
	 *   "Cancel"`; nothing is written until `Confirm`.
	 * - `button "Split"` opens `group "Split item"` with `list "Children"`, whose
	 *   `listitem`s have `textbox "Text"` and `textbox "Value"`, plus `button
	 *   "Add child"` and `button "Split item"`.
	 * - An answer that applies a retired item shows `To review` and counts in the
	 *   `{n} to review` of the progress region. The queue (`grading/`) shows
	 *   `{n} to review` on the question's row.
	 */
	const progress = page.getByRole("region", { name: "Progress" });
	const answer = page.getByRole("region", { name: "Answer", exact: true });
	const rubricPanel = page.getByRole("region", { name: "Rubric", exact: true });
	const score = page.getByRole("status", { name: "Score" });
	const heading = page.getByRole("heading", { level: 2 });
	const warning = page.getByRole("alert");
	const items = page
		.getByRole("list", { name: "Rubric items" })
		.getByRole("listitem");
	const worksRow = items.filter({ hasText: "Works" });

	async function openEditMode() {
		await heading.click();
		await page.keyboard.press("e");
		await expect(
			page.getByRole("button", { name: "Done editing" }),
		).toBeVisible();
	}

	async function scoresOf(): Promise<string[]> {
		const rows = await prisma.feedback.findMany({
			where: { rubricId: { not: null } },
			orderBy: { submissionId: "asc" },
		});
		return rows.map((row) => row.score);
	}

	await test.step("cancelling the warning leaves every grade as it was", async () => {
		await page.goto(`${grading}/${s.main.slug}`);
		await expect(progress).toContainText("1 pending");
		await openEditMode();

		await worksRow.getByRole("textbox", { name: "Value" }).fill("0.5");
		await page.getByRole("button", { name: "Apply changes" }).click();
		await expect(warning).toContainText(
			"Changes the score of 2 answers, 0 already released.",
		);
		await warning.getByRole("button", { name: "Cancel" }).click();

		await expect(warning).toHaveCount(0);
		expect(await scoresOf()).toEqual(["1", "0.6"]);
	});

	await test.step("after the release the warning counts the grades students already read", async () => {
		await s.release();
		await page.reload();
		await openEditMode();
		await worksRow.getByRole("textbox", { name: "Value" }).fill("0.5");
		await page.getByRole("button", { name: "Apply changes" }).click();

		await expect(warning).toContainText(
			"Changes the score of 2 answers, 2 already released.",
		);
		expect(await scoresOf()).toEqual(["1", "0.6"]);
	});

	await test.step("confirming recomputes the grades already given", async () => {
		await warning.getByRole("button", { name: "Confirm" }).click();
		await expect(warning).toHaveCount(0);
		await page.getByRole("button", { name: "Done editing" }).click();

		expect(await scoresOf()).toEqual(["0.9", "0.5"]);
		await page.keyboard.press("j");
		await expect(answer).toContainText("First graded");
		await expect(score).toHaveText("90%");
		await page.keyboard.press("j");
		await expect(answer).toContainText("Second graded");
		await expect(score).toHaveText("50%");
	});

	await test.step("splitting an item keeps the scores and marks its answers to review", async () => {
		await openEditMode();
		await worksRow.getByRole("button", { name: "Split" }).click();
		const form = page.getByRole("group", { name: "Split item" });
		const children = form
			.getByRole("list", { name: "Children" })
			.getByRole("listitem");
		await children
			.nth(0)
			.getByRole("textbox", { name: "Text" })
			.fill("Handles zero");
		await children.nth(0).getByRole("textbox", { name: "Value" }).fill("0.3");
		await children
			.nth(1)
			.getByRole("textbox", { name: "Text" })
			.fill("Handles negatives");
		await children.nth(1).getByRole("textbox", { name: "Value" }).fill("0.2");
		await form.getByRole("button", { name: "Split item" }).click();
		await page.getByRole("button", { name: "Done editing" }).click();

		await expect(progress).toContainText("2 to review");
		await expect(page.getByText("To review", { exact: true })).toBeVisible();
		expect(await scoresOf()).toEqual(["0.9", "0.5"]);
	});

	await test.step("the queue says how many answers of the question are to review", async () => {
		await page.goto(grading);

		const row = page
			.getByRole("list", { name: "Questions" })
			.getByRole("listitem")
			.filter({ has: page.getByRole("link") });
		await expect(row).toContainText("2 to review");
		await expect(row).toContainText("1 pending");
	});

	await test.step("regrading an answer with the new items clears its mark", async () => {
		await page.goto(`${grading}/${s.main.slug}`);
		const panel = rubricPanel;
		await expect(panel.getByRole("radio", { name: "Works" })).toHaveCount(0);
		await expect(
			panel.getByRole("radio", { name: "Handles zero" }),
		).toBeVisible();

		await page.keyboard.press("j");
		await expect(answer).toContainText("First graded");
		await page.keyboard.press("1");
		await pressShortcutOf(
			page,
			panel.getByRole("radio", { name: "Handles zero" }),
		);
		await expect(score).toHaveText("70%");
		await page.keyboard.press("Enter");

		await expect(progress).toContainText("1 to review");
		await expect(progress).toContainText("1 pending");
		expect((await scoresOf())[0]).toBe("0.7");
	});
});
