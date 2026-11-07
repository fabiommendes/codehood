import { expect, type Locator, type Page, test } from "@playwright/test";

/**
 * The `CodeRunner` widget through `/design/runner?view=widgets`, which shows
 * two widgets in `snippet` mode: the first reads a name with `prompt()`, the
 * second prints one line. The page does not create the runner iframe on load.
 */

const frames = (page: Page) => page.locator("iframe[data-runner-frame]");
const widget = (page: Page, index: number) =>
	page.locator("[data-code-runner]").nth(index);
const phase = (w: Locator) => w.getAttribute("data-phase");
const terminalText = (w: Locator) =>
	w.locator("[data-terminal] .xterm-accessibility-tree");

async function open(page: Page) {
	await page.goto("/design/runner?view=widgets");
	await page.bringToFront();
	await expect(page.locator("[data-code-runner]")).toHaveCount(2);
}

/// Clicks Edit and replaces the source with `code`.
async function setCode(w: Locator, code: string) {
	await w.locator("[data-action=edit]").click();
	const content = w.locator(".cm-content");
	await expect(content).toBeVisible();
	await content.fill(code);
}

const run = (w: Locator) => w.locator("[data-action=run]").click();

test("loading the page creates no iframe and downloads no editor or terminal", async ({
	page,
}) => {
	const scripts: string[] = [];
	page.on("response", async (response) => {
		if (response.request().resourceType() !== "script") return;
		scripts.push(await response.text().catch(() => ""));
	});
	await open(page);
	await page.waitForLoadState("networkidle");
	await expect(frames(page)).toHaveCount(0);
	await expect(page.locator(".cm-editor")).toHaveCount(0);
	await expect(page.locator(".xterm")).toHaveCount(0);
	for (const source of scripts) {
		expect(source).not.toContain("cm-editor");
		expect(source).not.toContain("xterm-helper-textarea");
	}
	// Focus brings them in.
	await widget(page, 0).locator("[data-editor-static]").focus();
	await expect(page.locator(".cm-editor")).toHaveCount(1);
});

test("focusing an editor creates a single iframe for both widgets", async ({
	page,
}) => {
	await open(page);
	await widget(page, 0).locator("[data-editor-static]").focus();
	await expect(frames(page)).toHaveCount(1);
	await widget(page, 1).locator("[data-editor-static]").focus();
	await expect(page.locator(".cm-editor")).toHaveCount(2);
	await expect(frames(page)).toHaveCount(1);
});

test("Run shows the output and the duration", async ({ page }) => {
	await open(page);
	const w = widget(page, 1);
	await run(w);
	await expect(terminalText(w)).toContainText("second");
	await expect(w).toHaveAttribute("data-phase", "done");
	await expect(w.locator("[data-status]")).toContainText("0");
});

test("Ctrl+Enter runs with the cursor in the editor", async ({ page }) => {
	await open(page);
	const w = widget(page, 1);
	await w.locator("[data-editor-static]").focus();
	await expect(w.locator(".cm-content")).toBeFocused();
	await page.keyboard.press("Control+Enter");
	await expect(terminalText(w)).toContainText("second");
});

test("prompt() reads a line typed in the terminal", async ({ page }) => {
	await open(page);
	const w = widget(page, 0);
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "waiting-input");
	await page.keyboard.type("Ada");
	await page.keyboard.press("Enter");
	await expect(terminalText(w)).toContainText("Hello, Ada!");
	await expect(w).toHaveAttribute("data-phase", "done");
});

test("Stop ends a loop in under 2 seconds", async ({ page }) => {
	await open(page);
	const w = widget(page, 1);
	await setCode(w, "while (true) {}");
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "running");
	const start = Date.now();
	await w.locator("[data-action=stop]").click();
	await expect(w).toHaveAttribute("data-phase", "stopped", { timeout: 2000 });
	expect(Date.now() - start).toBeLessThan(2000);
});

test("after Stop the focus returns to Run", async ({ page }) => {
	await open(page);
	const w = widget(page, 0);
	await setCode(w, "while (true) {}");
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "running");
	await w.locator("[data-action=stop]").click();
	await expect(w).toHaveAttribute("data-phase", "stopped", { timeout: 3000 });
	await expect(w.locator("[data-action=run]")).toBeFocused();
});

test("Ctrl+C in the terminal stops the run", async ({ page }) => {
	await open(page);
	const w = widget(page, 0);
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "waiting-input");
	await page.keyboard.press("Control+C");
	await expect(w).toHaveAttribute("data-phase", "stopped", { timeout: 3000 });
});

test("Ctrl+D sends end of input", async ({ page }) => {
	await open(page);
	const w = widget(page, 0);
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "waiting-input");
	await page.keyboard.press("Control+D");
	await expect(w).toHaveAttribute("data-phase", "done");
	await expect(terminalText(w)).toContainText("Hello, null!");
});

test("output past the limit is cut with a warning", async ({ page }) => {
	await open(page);
	const w = widget(page, 1);
	await setCode(w, 'while (true) console.log("x".repeat(1000));');
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "truncated", {
		timeout: 20_000,
	});
	await expect(w.locator("[data-status]")).toContainText(/limit|limite/i);
});

test("an exception shows the stack and the exit code", async ({ page }) => {
	await open(page);
	const w = widget(page, 1);
	await setCode(w, 'throw new Error("boom");');
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "error");
	await expect(terminalText(w)).toContainText("boom");
	await expect(w.locator("[data-status]")).toContainText(/\d/);
});

test("the stack points at the user's file and line, not at the runner", async ({
	page,
}) => {
	await open(page);
	const w = widget(page, 1);
	await setCode(w, '\n\nthrow new Error("boom");');
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "error");
	await expect(terminalText(w)).toContainText("main.js:3");
	await expect(terminalText(w)).not.toContainText("worker.js");
	await expect(terminalText(w)).not.toContainText("http");
});

test("Edit, change and Run uses the new code; Reset brings the original back", async ({
	page,
}) => {
	await open(page);
	const w = widget(page, 1);
	await setCode(w, 'console.log("changed");');
	await run(w);
	await expect(terminalText(w)).toContainText("changed");
	await w.locator("[data-action=reset]").click();
	await run(w);
	await expect(terminalText(w)).toContainText("second");
	await expect(terminalText(w)).not.toContainText("changed");
});

test("Try again retries one widget without recreating the iframe or stopping another run", async ({
	page,
}) => {
	await open(page);
	const busy = widget(page, 0);
	const other = widget(page, 1);
	await setCode(busy, "while (true) {}");
	await run(busy);
	await expect(busy).toHaveAttribute("data-phase", "running");

	await frames(page).evaluate((el) => {
		el.dataset.marker = "first";
	});
	await page.route("**/runner/*/worker.js", (route) =>
		route.fulfill({ status: 500 }),
	);
	await run(other);
	await expect(other).toHaveAttribute("data-phase", "load-failed");
	await page.unroute("**/runner/*/worker.js");
	await other.locator("[data-action=retry]").click();
	await expect(terminalText(other)).toContainText("second");
	await expect(other).toHaveAttribute("data-phase", "done");

	await expect(busy).toHaveAttribute("data-phase", "running");
	await expect(frames(page)).toHaveCount(1);
	await expect(frames(page)).toHaveAttribute("data-marker", "first");
});

test("preparing for more than 3 seconds says it is still loading, with Cancel", async ({
	page,
}) => {
	await open(page);
	await page.route("**/runner/frame*", () => {});
	const w = widget(page, 1);
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "preparing");
	const status = w.locator("[data-status]");
	await expect(status).toContainText(/Preparing|Preparando/);
	await expect(status).toContainText(/Still loading|Ainda carregando/, {
		timeout: 5000,
	});
	await w.locator("[data-action=stop]").click();
	await expect(w).toHaveAttribute("data-phase", "stopped");
});

test("Tab indents, and Esc then Tab leaves the editor, as the editor says", async ({
	page,
}) => {
	await open(page);
	const w = widget(page, 1);
	await setCode(w, "x");
	const content = w.locator(".cm-content");
	await content.press("Control+Home");
	await content.press("Tab");
	await expect(content).toHaveText(/^\s+x$/);
	const hint = await content.getAttribute("aria-describedby");
	expect(hint).toBeTruthy();
	await expect(page.locator(`#${hint}`)).toContainText(/Esc/);
	await content.press("Escape");
	await page.keyboard.press("Tab");
	await expect(content).not.toBeFocused();
	expect(
		await page.evaluate(() => !document.activeElement?.closest(".cm-editor")),
	).toBe(true);
});

test("the editor and the static view show line numbers", async ({ page }) => {
	await open(page);
	const w = widget(page, 0);
	await expect(
		w.locator("[data-editor-static] [data-line-numbers]"),
	).toBeVisible();
	await w.locator("[data-action=edit]").click();
	await expect(w.locator(".cm-lineNumbers")).toBeVisible();
});

test.describe("output is text", () => {
	test("HTML in the program output stays text", async ({ page }) => {
		await open(page);
		const w = widget(page, 1);
		await setCode(w, 'console.log("<img src=x onerror=window.__pwned=1>");');
		await run(w);
		await expect(terminalText(w)).toContainText("<img src=x onerror=");
		await expect(w.locator("[data-terminal] img")).toHaveCount(0);
		expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
	});

	test("HTML in a typed line stays text", async ({ page }) => {
		await open(page);
		const w = widget(page, 0);
		await run(w);
		await expect(w).toHaveAttribute("data-phase", "waiting-input");
		await page.keyboard.type("<img src=x onerror=window.__pwned=1>");
		await page.keyboard.press("Enter");
		await expect(terminalText(w)).toContainText("Hello, <img src=x onerror=");
		await expect(w.locator("img")).toHaveCount(0);
		expect(await page.evaluate(() => "__pwned" in window)).toBe(false);
	});
});

test.describe("links", () => {
	const URL_CODE = 'console.log("https://example.com/page");';

	test("a click asks first and does not open without confirmation", async ({
		page,
		context,
	}) => {
		await context.route("https://example.com/**", (route) =>
			route.fulfill({ body: "ok" }),
		);
		await open(page);
		const w = widget(page, 1);
		await setCode(w, URL_CODE);
		await run(w);
		await expect(terminalText(w)).toContainText("https://example.com/page");
		const screen = w.locator("[data-terminal] .xterm-screen");
		await screen.scrollIntoViewIfNeeded();
		const box = await screen.boundingBox();
		if (!box) throw new Error("terminal not visible");

		let opened = false;
		context.on("page", () => {
			opened = true;
		});
		const messages: string[] = [];
		page.on("dialog", (dialog) => {
			messages.push(dialog.message());
			void dialog.dismiss();
		});
		await page.mouse.move(box.x + 30, box.y + 8);
		await page.waitForTimeout(200);
		await page.mouse.click(box.x + 30, box.y + 8);
		await expect.poll(() => messages.length).toBe(1);
		expect(messages[0]).toContain("https://example.com/page");
		await page.waitForTimeout(500);
		expect(opened).toBe(false);

		page.removeAllListeners("dialog");
		page.on("dialog", (dialog) => void dialog.accept());
		const popup = context.waitForEvent("page");
		await page.mouse.click(box.x + 30, box.y + 8);
		const opener = await popup;
		expect(opener.url()).toMatch(/^https:\/\/example\.com\/page|^about:blank/);
	});
});

test("OSC 52 in the output does not touch the clipboard", async ({
	page,
	context,
}) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await open(page);
	await page.evaluate(() => navigator.clipboard.writeText("sentinel"));
	const w = widget(page, 1);
	await setCode(w, 'console.log("\\x1b]52;c;" + btoa("pwned") + "\\x07done");');
	await run(w);
	await expect(w).toHaveAttribute("data-phase", "done");
	await page.bringToFront();
	expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
		"sentinel",
	);
});

test.describe("touch screens", () => {
	test.use({
		viewport: { width: 390, height: 800 },
		hasTouch: true,
		isMobile: true,
	});

	test("input goes through the fixed field", async ({ page }) => {
		await open(page);
		const w = widget(page, 0);
		await w.locator("[data-action=run]").tap();
		await expect(w).toHaveAttribute("data-phase", "waiting-input");
		const field = w.locator("[data-line-input]");
		await expect(field).toBeVisible();
		const viewport = page.viewportSize();
		const box = await field.boundingBox();
		expect(box && viewport && box.y + box.height).toBeGreaterThan(
			(viewport?.height ?? 0) - 24,
		);
		expect(box && viewport && box.y + box.height).toBeLessThanOrEqual(
			(viewport?.height ?? 0) + 1,
		);
		await field.fill("Ada");
		await w.locator("[data-action=send]").tap();
		await expect(terminalText(w)).toContainText("Ada");
		await expect(terminalText(w)).toContainText("Hello, Ada!");
		await expect(w).toHaveAttribute("data-phase", "done");
		await expect(field).toHaveCount(0);
	});
});

test("the source shown before the editor mounts is the code itself", async ({
	page,
}) => {
	await open(page);
	await expect(widget(page, 0).locator("[data-editor-static]")).toContainText(
		'const name = prompt("Name?");',
	);
	expect(await phase(widget(page, 0))).toBe("idle");
});
