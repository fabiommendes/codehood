import { expect, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

/**
 * The getting-started page follows the CLI as it is: install, `codehood
 * init`, `codehood login`, write, `codehood push`. Students are told the CLI
 * is not for them yet.
 */

test.beforeEach(resetDatabase);

test("an instructor sees the install commands, init, login and push in order", async ({
	page,
}) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	await logInAs(page, instructor);
	await page.goto("/courses");

	const menu = page.locator("details.dropdown");
	await menu.locator("summary").click();
	await menu.getByRole("link", { name: "Set up the CLI" }).click();
	await expect(page).toHaveURL("/getting-started");

	const commands = page.locator("pre");
	await expect(commands).toContainText([
		/uv tool install --editable codehood\/cli/,
		/\$ codehood init[\s\S]*created {2}calendar\.md[\s\S]*next: codehood login/,
		new RegExp(`\\$ codehood login[\\s\\S]*as ${instructor.username}`),
		/\[servers\]/,
		/\$ codehood push[\s\S]*summary: 4 operation\(s\) executed/,
	]);
	await expect(page.locator("main")).not.toContainText("content/");
	await expect(page.locator("main")).not.toContainText(".q.md");
});

test("a student is not pointed at the CLI and the page says it is for instructors", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	await page.goto("/courses");

	const menu = page.locator("details.dropdown");
	await menu.locator("summary").click();
	await expect(menu.getByRole("link", { name: "Set up the CLI" })).toHaveCount(
		0,
	);

	await page.goto("/getting-started");
	await expect(page.locator("main")).toContainText(
		"The CLI is only for instructors for now.",
	);
	await expect(page.locator("main pre")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Generate CLI key" }),
	).toHaveCount(0);
});
