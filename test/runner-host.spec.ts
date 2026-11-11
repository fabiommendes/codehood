import { expect, type Page, test } from "./fixtures";

/**
 * The controls of the diagnostic page `/design/runner`, through the DOM.
 * `RunnerHost` itself is tested in `packages/runner/test/host.spec.ts`.
 */

async function openPage(page: Page) {
	await page.goto("/design/runner");
	await expect(page.locator("#transport")).not.toHaveText("connecting…");
}

test.describe("page controls", () => {
	test("run prints the program output", async ({ page }) => {
		await openPage(page);
		await page.locator("#code").fill('console.log("hi", 1 + 1)');
		await page.locator("#run").click();
		await expect(page.locator("#output")).toHaveText("hi 2\n");
		await expect(page.locator("#exit")).toHaveText(/exited \(code 0\)/);
		await expect(page.locator("#transport")).toHaveText(/^(sab|sw)$/);
	});

	test("stdin lines reach the program", async ({ page }) => {
		await openPage(page);
		await page.locator("#language").selectOption("fake");
		await page.locator("#code").fill("read\nread");
		await page.locator("#run").click();
		await expect(page.locator("#stdin")).toBeEnabled();
		await page.locator("#stdin").fill("one");
		await page.locator("#send").click();
		await page.locator("#eof").click();
		await expect(page.locator("#output")).toHaveText("one\nEOF\n");
	});

	test("stop ends the run as stopped", async ({ page }) => {
		await openPage(page);
		await page.locator("#language").selectOption("fake");
		await page.locator("#code").fill("loop");
		await page.locator("#run").click();
		await expect(page.locator("#stop")).toBeEnabled();
		await expect(page.locator("#status")).toHaveText("running");
		await page.locator("#stop").click();
		await expect(page.locator("#exit")).toHaveText("stopped");
		await expect(page.locator("#run")).toBeEnabled();
	});

	test("a run before the reserve is ready shows preparando…", async ({
		page,
	}) => {
		await openPage(page);
		await page.locator("#language").selectOption("fake");
		// `fill` would focus the editor and prepare a program-less reserve, which
		// loads at once; set the value without focus so the run itself loads.
		await page.evaluate(() => {
			(document.getElementById("code") as HTMLTextAreaElement).value =
				"load-delay 1500\nout x";
		});
		await page.locator("#run").click();
		await expect(page.locator("#status")).toHaveText("preparando…");
		await expect(page.locator("#exit")).toHaveText(/exited/);
	});

	test("the first focus of the editor prepares a reserve, page load does not", async ({
		page,
	}) => {
		await openPage(page);
		await page.locator("#language").selectOption("fake");
		await page.waitForTimeout(500);
		expect(page.workers()).toHaveLength(0);
		await page.locator("#code").focus();
		await expect.poll(() => page.workers().length).toBe(1);
	});
});
