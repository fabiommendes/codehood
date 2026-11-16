import type { Page } from "@playwright/test";
import { all, CORRECT, codeWorld, QUESTION } from "./code-grading-support";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase } from "./stories/helpers";

// Every block of code, read or edited, takes the site's code themes and
// follows the light/dark toggle: the student's review and the grading page.

test.beforeEach(resetDatabase);

/// The background of the code themes (`src/utils/code-themes.ts`), as computed.
const BACKGROUND = {
	light: "rgb(247, 243, 234)",
	dark: "rgb(8, 21, 16)",
};

/// Opens `path` with the site in `theme`, which it takes from the system's color scheme.
async function openIn(page: Page, theme: "light" | "dark", path: string) {
	await page.emulateMedia({ colorScheme: theme });
	await page.goto(path);
}

test("the review highlights the student's code in Your answer, in both themes", async ({
	page,
}) => {
	const world = await codeWorld();
	const student = await world.student("reviewed-student");
	await world.sendAndGrade(student, CORRECT, all("pass"));
	await world.close([student]);
	await logInAs(page, student);

	for (const theme of ["light", "dark"] as const) {
		await openIn(page, theme, world.href);
		const block = page
			.getByRole("region", { name: "Your answer" })
			.locator(".mdq-code pre.shiki");
		await expect(block).toContainText("List.foldl");
		await expect(
			block.locator('span[style*="--shiki-light"]').first(),
		).toBeVisible();
		await expect(block).toHaveCSS("background-color", BACKGROUND[theme]);
	}
});

test("the grading page draws the answer and the model answer in the code themes", async ({
	page,
}) => {
	const world = await codeWorld();
	const student = await world.student("graded-student");
	await world.sendAndGrade(student, CORRECT, all("pass"));
	await world.close([student]);
	await logInAs(page, world.instructor);

	for (const theme of ["light", "dark"] as const) {
		await openIn(page, theme, `${world.href}/grading/${QUESTION}?view=list`);
		for (const selector of ["[data-answer-code]", "[data-model-answer]"]) {
			const block = page.locator(selector).first();
			await expect(block).toHaveClass(/code-block/);
			await expect(block).toHaveCSS("background-color", BACKGROUND[theme]);
			await expect(
				block.locator('pre.shiki span[style*="--shiki-dark"]').first(),
			).toBeVisible();
		}
	}
});

test("the code editor of an open attempt takes the code themes and switches with the site", async ({
	page,
}) => {
	const world = await codeWorld();
	const student = await world.student("writing-student");
	await logInAs(page, student);
	await openIn(page, "light", world.href);
	const start = page.getByRole("button", { name: /start/i });
	if (await start.count()) await start.first().click();

	const editor = page.locator("[data-code-editor] .cm-editor");
	await expect(editor).toHaveCSS("background-color", BACKGROUND.light);
	await expect(editor.locator(".cm-shiki").first()).toBeVisible();
	const token = editor.locator(".cm-shiki").first();
	const light = await token.evaluate((span) => getComputedStyle(span).color);

	await page.evaluate(() =>
		document.documentElement.setAttribute("data-theme", "codehood-dark"),
	);
	await expect(editor).toHaveCSS("background-color", BACKGROUND.dark);
	await expect(token).not.toHaveCSS("color", light);
});
