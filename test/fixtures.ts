import {
	type Browser,
	type BrowserContext,
	test as base,
	type Page,
} from "@playwright/test";

export * from "@playwright/test";

/// How long a navigation waits for the islands before the test goes on anyway.
const HYDRATION_TIMEOUT_MS = 5000;

const patched = new WeakSet<object>();

/// Resolves once every island that hydrates on load has done so. Astro drops
/// the `ssr` attribute from an island when it hydrates.
async function hydrated(page: Page): Promise<void> {
	await page
		.waitForFunction(
			() =>
				document.querySelector('astro-island[ssr]:not([client="visible"])') ===
				null,
			undefined,
			{ timeout: HYDRATION_TIMEOUT_MS },
		)
		// A page whose island never hydrates is for the test to judge.
		.catch(() => {});
}

/// Makes `goto` and `reload` of `page` wait for hydration: a click that lands
/// on server-rendered markup before its island hydrates is lost.
function waitOnNavigation(page: Page): void {
	if (patched.has(page)) return;
	patched.add(page);
	const goto = page.goto.bind(page);
	const reload = page.reload.bind(page);
	page.goto = async (...args) => {
		const response = await goto(...args);
		await hydrated(page);
		return response;
	};
	page.reload = async (...args) => {
		const response = await reload(...args);
		await hydrated(page);
		return response;
	};
}

function watchContext(context: BrowserContext): void {
	if (patched.has(context)) return;
	patched.add(context);
	for (const page of context.pages()) waitOnNavigation(page);
	context.on("page", waitOnNavigation);
}

function watchBrowser(browser: Browser): void {
	if (patched.has(browser)) return;
	patched.add(browser);
	const newContext = browser.newContext.bind(browser);
	browser.newContext = async (...args) => {
		const context = await newContext(...args);
		watchContext(context);
		return context;
	};
}

/**
 * Playwright's `test`, with every page waiting for its islands to hydrate
 * after `goto` and `reload`.
 *
 * Specs that open pages import `test` from here instead of `@playwright/test`.
 * Navigation by a click on a link is not covered.
 */
export const test = base.extend<object, object>({
	browser: async ({ browser }, use) => {
		watchBrowser(browser);
		await use(browser);
	},
	context: async ({ context, javaScriptEnabled }, use) => {
		if (javaScriptEnabled !== false) watchContext(context);
		await use(context);
	},
	page: async ({ page, javaScriptEnabled }, use) => {
		// Nothing hydrates without scripts, and the wait itself needs them.
		if (javaScriptEnabled !== false) waitOnNavigation(page);
		await use(page);
	},
});
