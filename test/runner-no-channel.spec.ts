import { expect, type Page, test } from "@playwright/test";
import { loadFrame } from "./runner-harness";

/**
 * A browser with no stdin channel: no cross-origin isolation (Firefox, Safari)
 * and no service worker (private windows of Firefox and Safari). The spec
 * simulates both in every frame of the context, so it runs on any browser.
 */

test.beforeEach(async ({ context }) => {
	await context.addInitScript(() => {
		Object.defineProperty(globalThis, "crossOriginIsolated", { value: false });
		Object.defineProperty(Navigator.prototype, "serviceWorker", {
			get: () => undefined,
		});
	});
});

test("the frame announces stdin none when there is no channel", async ({
	page,
}) => {
	const h = await loadFrame(page);
	expect(h.ready.stdin).toBe("none");
});

test("Run says the browser is not supported", async ({
	page,
}: {
	page: Page;
}) => {
	await page.goto("/design/runner?view=widgets");
	await page.bringToFront();
	const w = page.locator("[data-code-runner]").first();
	await w.locator("[data-action=run]").click();
	await expect(w).toHaveAttribute("data-phase", "unsupported", {
		timeout: 20_000,
	});
	await expect(w).toContainText(
		/não consegue executar código|cannot run code here/,
	);
});
