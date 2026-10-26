import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { logInAs, resetDatabase, seedUser } from "./helpers";
import { sendReport, TINY_PNG } from "./report-support";

test.beforeEach(resetDatabase);

test("admin: triage the reports queue", async ({ page }) => {
	const admin = await seedUser({ role: "ADMIN" });
	const student = await seedUser({ role: "STUDENT" });
	const withShot = await sendReport(student, {
		kind: "BUG",
		message: "The grades table overflows on my phone.",
		url: "http://localhost/grades",
		viewport: "390x844",
		attachments: [{ filename: "screenshot.png", bytes: TINY_PNG }],
	});
	await sendReport(student, {
		kind: "SUGGESTION",
		message: "A dark theme for the exam page would be nice.",
	});
	const done = await sendReport(student, {
		kind: "OTHER",
		message: "Already handled report from last week.",
	});
	await db.report.update(
		{ publicId: done.publicId },
		{ status: "RESOLVED", note: "Duplicate of the calendar bug" },
		FULL_ACCESS,
	);

	await logInAs(page, admin);
	await page.goto("/admin");
	await page.getByRole("tab", { name: "Reports" }).click();
	await expect(page).toHaveURL(/\/admin\/reports/);

	await test.step("the queue starts on the open reports", async () => {
		await expect(page.getByRole("article")).toHaveCount(2);
		await expect(page.getByText("Already handled report")).toHaveCount(0);
	});

	await test.step("the queue narrows by type", async () => {
		await page
			.getByRole("group", { name: "Filter by type", exact: true })
			.locator("select")
			.selectOption({ label: "Bug" });
		await page.getByRole("button", { name: "Filter" }).click();
		await expect(page.getByRole("article")).toHaveCount(1);
	});

	await test.step("the screenshot of a report is shown and loads", async () => {
		const item = page.getByRole("article").filter({ hasText: "overflows" });
		await expect(item).toContainText("390x844");
		const shot = item.getByRole("img", { name: "screenshot.png" });
		await expect(shot).toBeVisible();
		await expect
			.poll(() => shot.evaluate((img: HTMLImageElement) => img.naturalWidth))
			.toBeGreaterThan(0);
	});

	await test.step("a resolved report leaves the open queue", async () => {
		const item = page.getByRole("article").filter({ hasText: "overflows" });
		await item
			.getByRole("group", { name: "Status", exact: true })
			.locator("select")
			.selectOption({ label: "Resolved" });
		await item.getByRole("button", { name: "Save" }).click();
		await expect(page.getByText("Report updated.")).toBeVisible();
		await expect(
			page.getByRole("article").filter({ hasText: "overflows" }),
		).toHaveCount(0);
	});

	await test.step("a resolved report keeps the note it was triaged with", async () => {
		await page
			.getByRole("group", { name: "Filter by status", exact: true })
			.locator("select")
			.selectOption({ label: "Resolved" });
		await page
			.getByRole("group", { name: "Filter by type", exact: true })
			.locator("select")
			.selectOption({ label: "All" });
		await page.getByRole("button", { name: "Filter" }).click();
		await expect(page.getByRole("article")).toHaveCount(2);
		const item = page
			.getByRole("article")
			.filter({ hasText: "Already handled" });
		await expect(
			item
				.getByRole("group", { name: "Note", exact: true })
				.locator("textarea"),
		).toHaveValue("Duplicate of the calendar bug");
	});

	expect(
		await db.report.findOne({ publicId: withShot.publicId }, FULL_ACCESS),
	).toMatchObject({ status: "RESOLVED", triagedBy: admin.username });
});
