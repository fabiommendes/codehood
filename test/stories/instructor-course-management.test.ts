import { expect, test } from "@playwright/test";
import {
	fillField,
	logInAs,
	openTab,
	resetDatabase,
	seedUser,
} from "./helpers";

test.beforeEach(resetDatabase);

test("instructor: issue an API key for the CLI, then revoke it", async ({
	page,
}) => {
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
