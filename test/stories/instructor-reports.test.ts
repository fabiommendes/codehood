import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./helpers";
import { sendReport } from "./report-support";

test.beforeEach(resetDatabase);

test("instructor: triage the content reports of my course", async ({
	page,
}) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	const typo = await sendReport(student, {
		kind: "CONTENT",
		course: course.id,
		message: "Typo in the title of the second lecture notes.",
		url: `http://localhost${href}/resources`,
	});
	const misfiled = await sendReport(student, {
		kind: "CONTENT",
		course: course.id,
		message: "The submit button spins forever on the exam page.",
	});
	await sendReport(student, {
		kind: "BUG",
		course: course.id,
		message: "The calendar is not loading for me today.",
	});

	await logInAs(page, instructor);
	await page.goto(href);

	await test.step("the Reports tab counts the open content reports", async () => {
		await page.getByRole("tab", { name: /Reports\s*2/ }).click();
		await expect(page).toHaveURL(new RegExp(`${href}/reports`));
		await expect(page.getByRole("article")).toHaveCount(2);
		await expect(page.getByText("The calendar is not loading")).toHaveCount(0);
	});

	await test.step("a report is triaged with a note", async () => {
		const item = page
			.getByRole("article")
			.filter({ hasText: "Typo in the title" });
		await expect(item).toContainText(student.username);
		await expect(item).toContainText(`${href}/resources`);
		await item
			.getByRole("group", { name: "Status", exact: true })
			.locator("select")
			.selectOption({ label: "Triaged" });
		await item
			.getByRole("group", { name: "Note", exact: true })
			.locator("textarea")
			.fill("Fix in the next push");
		await item.getByRole("button", { name: "Save" }).click();
		await expect(page.getByText("Report updated.")).toBeVisible();
	});

	await test.step("a report that is a bug in Codehood goes to the admin and leaves the queue", async () => {
		const item = page
			.getByRole("article")
			.filter({ hasText: "submit button spins" });
		await item
			.getByRole("group", { name: "Type", exact: true })
			.locator("select")
			.selectOption({ label: "Bug" });
		await item.getByRole("button", { name: "Save" }).click();
		await expect(
			page.getByRole("article").filter({ hasText: "submit button spins" }),
		).toHaveCount(0);
	});

	expect(
		await db.report.findOne({ publicId: typo.publicId }, FULL_ACCESS),
	).toMatchObject({
		status: "TRIAGED",
		note: "Fix in the next push",
		triagedBy: instructor.username,
	});
	expect(
		await db.report.findOne({ publicId: misfiled.publicId }, FULL_ACCESS),
	).toMatchObject({ kind: "BUG", status: "OPEN" });

	await page.goto(href);
	await expect(
		page.getByRole("tab", { name: "Reports", exact: true }),
	).toBeVisible();
});
