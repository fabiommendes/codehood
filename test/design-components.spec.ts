import { expect, test } from "@playwright/test";

test("design/components renders every section without errors or action calls", async ({
	page,
}) => {
	const errors: string[] = [];
	const actionCalls: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("request", (request) => {
		if (request.url().includes("/_actions/")) actionCalls.push(request.url());
	});

	const response = await page.goto("/design/components");
	expect(response?.status()).toBe(200);

	for (const title of [
		"Check-in",
		"Roll call",
		"Projection",
		"Exam exceptions",
		"Grade release",
		"Regrades",
		"Statistics",
	]) {
		await expect(
			page.getByRole("heading", { level: 2, name: title, exact: true }),
		).toBeVisible();
	}
	// Static islands: nothing is hydrated, so nothing can poll.
	await expect(page.locator("astro-island")).toHaveCount(0);

	await page.waitForTimeout(1000);
	expect(errors).toEqual([]);
	expect(actionCalls).toEqual([]);
});
