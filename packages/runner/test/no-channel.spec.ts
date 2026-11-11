import { expect, test } from "@playwright/test";
import { loadFrame } from "../src/testing/suite";

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
