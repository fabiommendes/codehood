import { expect, test } from "@playwright/test";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { logInAs, resetDatabase, seedUser } from "./helpers";
import {
	actingAs,
	createRepository,
	hrefOf,
	pushTree,
} from "./repository-support";

/*
 * UI contract assumed by these stories (en build; the spec leaves the wording
 * open, so the implementation should use these strings).
 *
 * Course tabs
 *   - A tab (role "tab") "Repositories" (after "Schedule") to `<course>/repositories`.
 *
 * Repository page (`<course>/repositories/<slug>`)
 *   - Heading with the repository title (H1 of the root README, or the slug).
 *   - Before the first commit: the text "Awaiting the first push".
 *   - After it: the text `git clone <cloneUrl>` and a link "Download zip".
 *   - Listing of the root: one link per entry, named after it ("calc" or
 *     "calc/" for a folder); a folder link leads to its listing, a file link
 *     to the file.
 *   - A button "Generate new clone URL" (instructors only). Clicking it shows
 *     a confirmation form with a button "Confirm"; submitting it reloads the
 *     page with the new URL.
 */

test.beforeEach(resetDatabase);

test("instructor: Share a repository with the class", async ({ page }) => {
	const instructor = await seedUser({
		role: "INSTRUCTOR",
		username: "ir-teacher",
		name: "Irene Teacher",
	});
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const href = hrefOf(course);
	await createRepository(course.id, "ir-lab", instructor);
	await logInAs(page, instructor);

	await test.step("a repository without a commit shows the instructor it is waiting", async () => {
		await page.goto(href);
		await page.getByRole("tab", { name: "Repositories", exact: true }).click();
		await page.getByRole("link", { name: "ir-lab" }).click();

		await expect(page.getByText("Awaiting the first push")).toBeVisible();
		await expect(page.getByRole("link", { name: "Download zip" })).toHaveCount(
			0,
		);
	});

	await test.step("after the push the instructor walks down to a file in a folder", async () => {
		await pushTree(
			course.id,
			"ir-lab",
			instructor,
			{
				"README.md": "# Irene's Lab\n\nStart here.\n",
				"calc/ops.py": "def add(a, b):\n    return a + b\n",
			},
			"First version",
		);
		await page.goto(`${href}/repositories/ir-lab`);

		await expect(
			page.getByRole("heading", { name: "Irene's Lab" }),
		).toBeVisible();
		await expect(page.getByText("Awaiting the first push")).toHaveCount(0);
		await page.getByRole("link", { name: /^calc\/?$/ }).click();
		await page.getByRole("link", { name: "ops.py" }).click();

		await expect(
			page.getByRole("code").filter({ hasText: "def add(a, b):" }),
		).toBeVisible();
	});

	await test.step("asking for a new clone URL changes the URL on the page", async () => {
		await page.goto(`${href}/repositories/ir-lab`);
		const cloneCommand = page.getByText(/git clone https?:\/\/\S+/);
		const before = await cloneCommand.textContent();

		await page.getByRole("button", { name: "Generate new clone URL" }).click();
		await page.getByRole("button", { name: "Confirm" }).click();

		await expect(cloneCommand).not.toHaveText(before ?? "");
		const stored = await db.repository.findOne(
			{ course: course.id, slug: "ir-lab" },
			actingAs(instructor),
		);
		await expect(cloneCommand).toContainText(stored?.cloneUrl ?? "missing");
		expect(before).not.toContain(stored?.cloneUrl);
	});
});
