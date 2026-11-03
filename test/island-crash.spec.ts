import { expect, test } from "@playwright/test";

/**
 * An island that throws while the server renders it answers with the error
 * page, instead of a response that never completes.
 */

test("a page whose island throws answers 500 with the error page", async ({
	page,
}) => {
	const response = await page.goto("/design/crash", { timeout: 10_000 });
	expect(response?.status()).toBe(500);
	await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
});
