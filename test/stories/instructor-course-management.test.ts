import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import {
	fillField,
	logInAs,
	openTab,
	resetDatabase,
	seedUser,
} from "./helpers";

test.beforeEach(resetDatabase);

test("instructor: issue and revoke an API key", async ({ page }) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });

	await logInAs(page, instructor);
	await page.goto("/profile");
	await openTab(page, "API keys");

	await test.step("the key is created and its token shown once", async () => {
		await fillField(page, "Key name", "laptop");
		await page.getByRole("button", { name: "Create key" }).click();

		await openTab(page, "API keys");
		await expect(page.getByText("laptop")).toBeVisible();
	});

	await test.step("and revoking it takes it off the list", async () => {
		await page.getByRole("button", { name: "Revoke" }).click();

		await openTab(page, "API keys");
		await expect(page.getByText("laptop")).toHaveCount(0);
	});
});

test("instructor: get started with the CLI", async ({ page }) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create(
		{ instructor: instructor.username },
		{ transient: { students: 1 } },
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	});
	const emptyPages = [
		href,
		`${href}/resources`,
		`${href}/schedule`,
		`${href}/exams`,
	];
	const setUpLink = page.getByRole("link", { name: "Set up the CLI" });

	await test.step("a student of the empty course is not pointed at the CLI", async () => {
		// biome-ignore lint/style/noNonNullAssertion: the factory created one student.
		await logInAs(page, course.students[0]!);
		for (const path of emptyPages) {
			await page.goto(path);
			await expect(setUpLink).toHaveCount(0);
		}
		await page.context().clearCookies();
	});

	await logInAs(page, instructor);

	await test.step("every empty page of their course links to the guide", async () => {
		for (const path of emptyPages) {
			await page.goto(path);
			await expect(setUpLink.first()).toHaveAttribute(
				"href",
				"/getting-started",
			);
		}
	});

	await test.step("and following it opens the guide", async () => {
		await page.goto(href);
		await setUpLink.first().click();
		await expect(page).toHaveURL("/getting-started");
	});

	await test.step("the page walks through the CLI in order", async () => {
		const headings = page.getByRole("listitem");
		await expect(headings).toContainText([
			/Scaffold a course/,
			/Write your content/,
			/Create a CLI API key/,
			/Push, and it's live/,
		]);
	});

	await test.step("and generating a CLI key is one click away", async () => {
		await page.getByRole("button", { name: "Generate CLI key" }).click();
		await expect(
			page.getByText("Key created — copy it now, it won't be shown again."),
		).toBeVisible();
	});

	// The key that came back is a real CLI key the instructor now owns.
	const keys = await db.apiKey.findMany(
		{ createdBy: instructor.username },
		FULL_ACCESS,
	);
	expect(keys).toHaveLength(1);
	expect(keys[0]?.kind).toBe("CLI");
});
