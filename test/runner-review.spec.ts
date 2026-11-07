import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The `CodeRunner` widget in `review` mode through `/design/runner?view=review`:
 * three submissions (A sets a global and fails, B reads the global, C loops
 * forever) sharing one exclusive runner host.
 */

const frames = (page: Page) =>
	page.locator("iframe[data-runner-frame=exclusive]");
const widget = (page: Page, index: number) =>
	page.locator("[data-code-runner]").nth(index);
const terminalText = (w: Locator) =>
	w.locator("[data-terminal] .xterm-accessibility-tree");
const run = (w: Locator) => w.locator("[data-action=run]").click();

async function open(page: Page) {
	await page.goto("/design/runner?view=review");
	await page.bringToFront();
	await expect(page.locator("[data-code-runner]")).toHaveCount(3);
	// Hydrated: clicks before that do nothing.
	await expect(page.locator("astro-island[ssr]")).toHaveCount(0);
}

/// Clicks Edit copy and replaces the source with `code`.
async function editCopy(w: Locator, code: string) {
	await w.locator("[data-action=edit]").click();
	const content = w.locator(".cm-content");
	await expect(content).toBeVisible();
	await content.fill(code);
}

test("the first Run creates one exclusive iframe", async ({ page }) => {
	await open(page);
	await expect(frames(page)).toHaveCount(0);
	await run(widget(page, 1));
	await expect(frames(page)).toHaveCount(1);
	await expect(terminalText(widget(page, 1))).toContainText("b sees undefined");
	await expect(page.locator("iframe[data-runner-frame=shared]")).toHaveCount(0);
});

test("running another submission replaces the iframe", async ({ page }) => {
	await open(page);
	await run(widget(page, 1));
	await expect(widget(page, 1)).toHaveAttribute("data-phase", "done");
	const first = await frames(page).elementHandle();
	await run(widget(page, 0));
	await expect(widget(page, 0)).not.toHaveAttribute("data-phase", "idle");
	await expect(widget(page, 0)).toHaveAttribute("data-phase", "error");
	expect(await first?.evaluate((el) => el.isConnected)).toBe(false);
	await expect(frames(page)).toHaveCount(1);
});

test("running the same submission again keeps the iframe", async ({ page }) => {
	await open(page);
	await run(widget(page, 1));
	await expect(widget(page, 1)).toHaveAttribute("data-phase", "done");
	const first = await frames(page).elementHandle();
	await run(widget(page, 1));
	await expect(terminalText(widget(page, 1))).toContainText("b sees undefined");
	await expect(widget(page, 1)).toHaveAttribute("data-phase", "done");
	expect(await first?.evaluate((el) => el.isConnected)).toBe(true);
});

test("a new run stops the one in progress, even from another card", async ({
	page,
}) => {
	await open(page);
	await run(widget(page, 2));
	await expect(widget(page, 2)).toHaveAttribute("data-phase", "running");
	await run(widget(page, 1));
	await expect(widget(page, 2)).toHaveAttribute("data-phase", "stopped");
	await expect(widget(page, 1)).toHaveAttribute("data-phase", "done");
	await expect(page.locator("[data-phase=running]")).toHaveCount(0);
});

test("a global set by one submission does not exist in the next", async ({
	page,
}) => {
	await open(page);
	await run(widget(page, 0));
	await expect(widget(page, 0)).toHaveAttribute("data-phase", "error");
	await run(widget(page, 1));
	await expect(terminalText(widget(page, 1))).toContainText("b sees undefined");
});

test("editing the copy shows the badge and Back to submission restores the original", async ({
	page,
}) => {
	await open(page);
	const w = widget(page, 1);
	await expect(w.locator("[data-role=modified]")).toHaveCount(0);
	await editCopy(w, 'console.log("copy");');
	await expect(w.locator("[data-role=modified]")).toBeVisible();
	await expect(w.locator("[data-role=copy-hint]")).toContainText("memory");
	await expect(w.locator("[data-action=run]")).toContainText("Run submission");
	await w.locator("[data-action=back]").click();
	await expect(w.locator("[data-role=modified]")).toHaveCount(0);
	await expect(w.locator(".cm-content")).toContainText(
		'console.log("b sees " + typeof globalThis.x);',
	);
	await run(w);
	await expect(terminalText(w)).toContainText("b sees undefined");
	await expect(w.locator("[data-run-modified]")).toHaveCount(0);
});

test("the output of a modified copy starts with a notice and the status bar says modified", async ({
	page,
}) => {
	await open(page);
	const w = widget(page, 1);
	await editCopy(w, 'console.log("copy");');
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "done");
	await expect(terminalText(w)).toContainText("output of the modified copy");
	await expect(terminalText(w)).toContainText("copy");
	await expect(w.locator("[data-status] [data-run-modified]")).toBeVisible();
	await expect(w.locator("[data-status]")).toHaveAttribute(
		"data-exit-code",
		"0",
	);
});

test("editing and running a copy sends nothing to the app and stores nothing", async ({
	page,
}) => {
	await open(page);
	const w = widget(page, 1);
	await w.locator("[data-editor-static]").focus();
	await expect(w.locator(".cm-editor")).toHaveCount(1);
	const before = await page.evaluate(() => ({ ...localStorage }));
	const appOrigin = new URL(page.url()).origin;
	const requests: string[] = [];
	page.on("request", (request) => {
		const url = request.url();
		if (url.startsWith(appOrigin) && !url.includes("/_astro/")) {
			requests.push(`${request.method()} ${url}`);
		}
	});
	await editCopy(w, 'console.log("copy");');
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "done");
	await w.locator("[data-action=back]").click();
	expect(requests).toEqual([]);
	expect(await page.evaluate(() => ({ ...localStorage }))).toEqual(before);
	expect(await page.evaluate(() => ({ ...sessionStorage }))).toEqual({});
});

test("terminal output cannot change the badge or the exit code in the status bar", async ({
	page,
}) => {
	await open(page);
	const w = widget(page, 0);
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "error");
	// The program printed ESC c (full reset), "exit 0" and "modified".
	await expect(terminalText(w)).toContainText("modified");
	await expect(terminalText(w)).toContainText("exit 0");
	const status = w.locator("[data-status]");
	await expect(status).toHaveAttribute("data-exit-code", "1");
	await expect(status).not.toContainText("code 0");
	await expect(w.locator("[data-run-modified]")).toHaveCount(0);
	await expect(w.locator("[data-role=modified]")).toHaveCount(0);
});

test("the badge of a modified run survives output that resets the terminal", async ({
	page,
}) => {
	await open(page);
	const w = widget(page, 1);
	await editCopy(w, 'console.log("\\x1bcexit 0 clean");');
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "done");
	await expect(terminalText(w)).toContainText("exit 0 clean");
	await expect(w.locator("[data-status] [data-run-modified]")).toBeVisible();
	await expect(w.locator("[data-status]")).toHaveAttribute(
		"data-exit-code",
		"0",
	);
});

test("three quick clicks on Run end with the last one running alone", async ({
	page,
}) => {
	await open(page);
	await page.evaluate(() => {
		for (const button of document.querySelectorAll<HTMLButtonElement>(
			"[data-action=run]",
		)) {
			button.click();
		}
	});
	await expect(widget(page, 2)).toHaveAttribute("data-phase", "running");
	await expect(page.locator("[data-phase=running]")).toHaveCount(1);
	await expect(widget(page, 0)).toHaveAttribute("data-phase", "stopped");
	await expect(widget(page, 1)).toHaveAttribute("data-phase", "stopped");
	await expect(terminalText(widget(page, 1))).not.toContainText("b sees");
	await widget(page, 2).locator("[data-action=stop]").click();
	await expect(widget(page, 2)).toHaveAttribute("data-phase", "stopped");
});

test("the copy of a card stays after running another card", async ({
	page,
}) => {
	await open(page);
	const first = widget(page, 1);
	await editCopy(first, 'console.log("kept");');
	await run(widget(page, 0));
	await expect(widget(page, 0)).toHaveAttribute("data-phase", "error");
	await expect(first.locator("[data-role=modified]")).toBeVisible();
	await expect(first.locator(".cm-content")).toContainText("kept");
	await run(first);
	await expect(terminalText(first)).toContainText("kept");
});

test("the arrows move between cards, set the anchor and focus Run", async ({
	page,
}) => {
	await open(page);
	const first = widget(page, 0);
	await expect(first.locator("[data-role=position]")).toHaveText("1 of 3");
	await expect(first.locator("[data-role=review-label]")).toHaveText(
		"Submission A",
	);
	await expect(first.locator("[data-action=previous]")).toBeDisabled();
	await first.locator("[data-action=next]").click();
	await expect(page).toHaveURL(/#answer-sub-b$/);
	await expect(widget(page, 1).locator("[data-action=run]")).toBeFocused();
	await widget(page, 1).locator("[data-action=next]").click();
	await expect(page).toHaveURL(/#answer-sub-c$/);
	await expect(widget(page, 2).locator("[data-action=next]")).toBeDisabled();
	await widget(page, 2).locator("[data-action=previous]").click();
	await expect(widget(page, 1).locator("[data-action=run]")).toBeFocused();
	// Moving runs nothing and creates no frame.
	await expect(frames(page)).toHaveCount(0);
});

test("a review widget without a submission fails loudly instead of running", async ({
	page,
}) => {
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error") errors.push(message.text());
	});
	await page.goto("/design/runner?view=review-orphan");
	await page.bringToFront();
	await expect.poll(() => errors.join("\n")).toMatch(/needs a submission/);
});
