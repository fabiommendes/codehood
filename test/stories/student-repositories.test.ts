import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { logInAs, resetDatabase, seedUser } from "./helpers";
import {
	createRepository,
	eventCiting,
	hrefOf,
	pushTree,
} from "./repository-support";

/*
 * UI contract assumed by these stories (en build; the spec leaves the wording
 * open, so the implementation should use these strings).
 *
 * Course tabs
 *   - A tab (role "tab") "Repositories" (exact), shown to a student only when the course
 *     has a repository with a commit.
 *
 * Repositories tab (`<course>/repositories`)
 *   - One link per repository named after its title (H1 of the root README);
 *     its row also shows the latest commit message.
 *
 * Schedule (`<course>/schedule`)
 *   - Elements whose id starts with `event-`; the card of a meeting that cites
 *     a repository holds a link named after the repository title, leading to
 *     `<course>/repositories/<slug>`.
 *
 * Repository page (`<course>/repositories/<slug>`)
 *   - The text `git clone <cloneUrl>`, a button "Copy" that puts that command
 *     on the clipboard, a link "Download zip" to `<slug>.zip` (served as an
 *     attachment), the latest commit message, and the rendered root README.
 *   - Listing: one link per entry named after it ("calc" or "calc/" for a
 *     folder).
 *
 * Path pages (`<course>/repositories/<slug>/<path>`)
 *   - Folder: listing plus its README.md rendered.
 *   - Source file: its text inside an element with the ARIA role "code".
 *   - Missing path: HTTP 404.
 */

test.beforeEach(resetDatabase);

const ZIP_MAGIC = "PK";

test("student: Find a course repository", async ({ page }) => {
	const instructor = await seedUser({
		role: "INSTRUCTOR",
		username: "sf-teacher",
		name: "Sara Teacher",
	});
	const student = await seedUser({ role: "STUDENT", username: "sf-ana" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const href = hrefOf(course);
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slot = await persistedTimeSlotFactory.create({ course: course.id });
	await logInAs(page, student);

	await test.step("a course without repositories has no Repositories tab", async () => {
		await page.goto(href);
		await expect(
			page.getByRole("tab", { name: "Schedule", exact: true }),
		).toBeVisible();
		await expect(
			page.getByRole("tab", { name: "Repositories", exact: true }),
		).toHaveCount(0);
	});

	await test.step("a repository still waiting for its first push does not create the tab", async () => {
		await createRepository(course.id, "sf-pending", instructor);
		await page.goto(href);
		await expect(
			page.getByRole("tab", { name: "Repositories", exact: true }),
		).toHaveCount(0);
	});

	await test.step("the tab lists a repository with its title and last commit", async () => {
		await pushTree(
			course.id,
			"sf-lab",
			instructor,
			{ "README.md": "# Calculator Lab\n" },
			"Add the starter files",
		);
		await eventCiting(course.id, slot.id, "sf-Lab session", ["sf-lab"]);
		await page.goto(href);
		await expect(page.getByRole("tab")).toHaveText([
			"Home",
			"Exams",
			"Resources",
			"Schedule",
			"Repositories",
		]);
		await page.getByRole("tab", { name: "Repositories", exact: true }).click();

		await expect(
			page.getByRole("link", { name: "Calculator Lab" }),
		).toBeVisible();
		await expect(page.getByText("Add the starter files")).toBeVisible();
		await expect(page.getByText("sf-pending")).toHaveCount(0);
	});

	await test.step("the lesson card on the schedule links to the repository", async () => {
		await page.goto(`${href}/schedule`);
		const card = page
			.locator('[id^="event-"]')
			.filter({ hasText: "sf-Lab session" });
		await card.getByRole("link", { name: "Calculator Lab" }).click();

		await expect(page).toHaveURL(`${href}/repositories/sf-lab`);
		await expect(
			page.getByRole("heading", { name: "Calculator Lab" }),
		).toBeVisible();
	});
});

test("student: Read and download a course repository", async ({
	page,
	context,
}) => {
	const instructor = await seedUser({
		role: "INSTRUCTOR",
		username: "sr-teacher",
		name: "Rita Teacher",
	});
	const student = await seedUser({ role: "STUDENT", username: "sr-ben" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const href = hrefOf(course);
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await pushTree(
		course.id,
		"sr-lab",
		instructor,
		{
			"README.md": "# Root Lab\n\nWelcome to the lab.\n",
			"calc/ops.py": "def add(a, b):\n    return a + b\n",
			"docs/README.md": "# Usage notes\n\nRun the tests first.\n",
			"docs/guide.txt": "plain guide\n",
		},
		"Initial lab",
	);
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await logInAs(page, student);
	const repo = `${href}/repositories/sr-lab`;
	const stored = await db.repository.findOne(
		{ course: course.id, slug: "sr-lab" },
		FULL_ACCESS,
	);
	const cloneUrl = stored?.cloneUrl ?? "missing";

	await test.step("the page shows the clone command and the rendered README", async () => {
		await page.goto(repo);

		await expect(page.getByText(`git clone ${cloneUrl}`)).toBeVisible();
		await expect(page.getByText("Initial lab")).toBeVisible();
		await expect(page.getByText("Welcome to the lab.")).toBeVisible();
		await expect(page.getByRole("link", { name: /^calc\/?$/ })).toBeVisible();
	});

	await test.step("copying the command puts it on the clipboard", async () => {
		await page.getByRole("button", { name: "Copy" }).click();

		const copied = await page.evaluate(() => navigator.clipboard.readText());
		expect(copied).toBe(`git clone ${cloneUrl}`);
	});

	await test.step("a source file opens as code", async () => {
		await page.getByRole("link", { name: /^calc\/?$/ }).click();
		await page.getByRole("link", { name: "ops.py" }).click();

		await expect(
			page.getByRole("code").filter({ hasText: "def add(a, b):" }),
		).toBeVisible();
	});

	await test.step("a folder shows its README under the listing", async () => {
		await page.goto(`${repo}/docs`);

		await expect(page.getByRole("link", { name: "guide.txt" })).toBeVisible();
		await expect(
			page.getByRole("heading", { name: "Usage notes" }),
		).toBeVisible();
		await expect(page.getByText("Run the tests first.")).toBeVisible();
	});

	await test.step("a path that does not exist is not found", async () => {
		const response = await page.goto(`${repo}/calc/missing.py`);

		expect(response?.status()).toBe(404);
	});

	await test.step("the zip download saves the latest commit as an archive", async () => {
		await page.goto(repo);
		const downloading = page.waitForEvent("download");
		await page.getByRole("link", { name: "Download zip" }).click();
		const download = await downloading;

		expect(download.suggestedFilename()).toBe("sr-lab.zip");
		const path = await download.path();
		const bytes = await readFile(path);
		expect(bytes.subarray(0, 2).toString("latin1")).toBe(ZIP_MAGIC);
	});
});
