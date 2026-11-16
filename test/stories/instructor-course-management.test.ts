import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { expect, test } from "../fixtures";
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
			/Install the CLI/,
			/Scaffold a course/,
			/Log in/,
			/Write your content/,
			/Push, and it's live/,
		]);
	});

	await test.step("and generating a CLI key is one click away", async () => {
		await page.getByRole("button", { name: "Generate CLI key" }).click();
		await expect(
			page.getByText("Key created. Copy it now, it won't be shown again."),
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

test("instructor: check a course's settings", async ({ page }) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create(
		{ instructor: instructor.username },
		{ transient: { students: 1 } },
	);
	const student = course.students[0];
	if (!student) throw new Error("expected the course to have a student");
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	});

	await test.step("a student of the course does not reach the settings", async () => {
		await logInAs(page, student);
		await page.goto(href);
		await expect(
			page
				.locator("[data-course-card]")
				.getByRole("link", { name: "Settings", exact: true }),
		).toHaveCount(0);
		const response = await page.goto(`${href}/settings`);
		expect(response?.status()).not.toBe(200);
	});

	await logInAs(page, instructor);

	await test.step("the course card on the home leads to the settings", async () => {
		await page.goto(href);
		await page
			.locator("[data-course-card]")
			.getByRole("link", { name: "Settings", exact: true })
			.click();
		await expect(page).toHaveURL(`${href}/settings`);
		await expect(
			page.getByRole("tab", { name: "Home", selected: true }),
		).toBeVisible();
	});

	await test.step("the course fields say which file of the repository they come from", async () => {
		const fields = page.getByRole("region", { name: "Course", exact: true });
		await expect(fields).toContainText(course.edition.slug);
		await expect(fields).toContainText(instructor.name);
		await expect(fields).toContainText(course.description ?? "");
		await expect(fields).toContainText("from calendar.md");
		await expect(fields).toContainText("from README.md");
		await expect(fields.getByRole("textbox")).toHaveCount(0);
	});

	await test.step("the CLI commands come filled in for this course", async () => {
		const cli = page.getByRole("region", { name: "CLI", exact: true });
		await expect(cli.locator("code").first()).toHaveText(
			new RegExp(
				`^codehood init --discipline ${course.discipline.slug} --instructor ${instructor.username} --edition ${course.edition.slug} --server https?://`,
			),
		);
		await expect(cli.locator("code").nth(1)).toHaveText("codehood login");
		await expect(cli.getByRole("button", { name: "Copy" })).toHaveCount(2);
	});
});
