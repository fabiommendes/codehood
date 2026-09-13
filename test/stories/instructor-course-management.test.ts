import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { apiKeyService } from "@/db/services/api-key.service";
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

	await logInAs(page, instructor);
	await page.goto("/getting-started");

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
	const keys = await apiKeyService.findMany(
		{ createdById: instructor.username },
		FULL_ACCESS,
	);
	expect(keys).toHaveLength(1);
	expect(keys[0].kind).toBe("CLI");
});
