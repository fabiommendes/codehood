import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "./fixtures";

/// The runner messages of the locale the test server is built for. The spec
/// fixes the keys and their pt-BR text; the default test build is English.
const t: Record<
	| "runner_window_label"
	| "runner_window_inline"
	| "runner_window_collapse"
	| "runner_window_maximize"
	| "runner_run"
	| "runner_run_hint"
	| "runner_stop",
	string
> = JSON.parse(
	readFileSync(
		new URL(
			`../messages/${process.env.CODEHOOD_LOCALE === "pt-BR" ? "pt-BR" : "en"}/runner.json`,
			import.meta.url,
		),
		"utf8",
	),
);

/**
 * The editor window of `CodeRunner` in `snippet` mode, through
 * `/design/runner?view=widgets` (two snippets, the first reads a name with
 * `prompt()`, the second prints "second"), on a desktop viewport.
 */

test.use({ viewport: { width: 1440, height: 900 } });

const WIDGETS = "/design/runner?view=widgets";
const SECOND_CODE = 'console.log("second");';

const win = (page: Page, index = 0) =>
	page.locator("[data-window-state]").nth(index);
const widget = (page: Page, index = 0) =>
	page.locator("[data-code-runner]").nth(index);
const toolbar = (w: Locator) =>
	w.getByRole("toolbar", { name: t.runner_window_label });
const dot = (w: Locator, state: "inline" | "collapsed" | "maximized") =>
	w.locator(`[data-action=window-${state}]`);
const terminalText = (w: Locator) =>
	w.locator("[data-terminal] .xterm-accessibility-tree");

async function open(page: Page) {
	await page.goto(WIDGETS);
	await page.bringToFront();
	await expect(page.locator("[data-code-runner]")).toHaveCount(2);
	await expect(page.locator("[data-window-state]")).toHaveCount(2);
}

/// Clicks Edit on the snippet and replaces the source with `code`.
async function setCode(page: Page, index: number, code: string) {
	const w = widget(page, index);
	await w.locator("[data-action=edit]").click();
	const content = w.locator(".cm-content");
	await expect(content).toBeVisible();
	await content.fill(code);
}

/// Whether the code view (static or live) is cut away: it, or an ancestor
/// inside the window that clips its content, has no height left.
async function codeIsHidden(scope: Locator): Promise<boolean> {
	return scope.evaluate((root) => {
		const clipped = (start: Element) => {
			for (
				let el: Element | null = start;
				el && el !== root;
				el = el.parentElement
			) {
				const css = getComputedStyle(el);
				if (css.display === "none" || css.visibility === "hidden") return true;
				if (
					css.overflowY !== "visible" &&
					el.getBoundingClientRect().height < 2
				)
					return true;
			}
			return false;
		};
		return [...root.querySelectorAll("[data-editor-static], .cm-editor")].every(
			clipped,
		);
	});
}

/// Adds room below the snippets so the page can scroll.
async function makeScrollable(page: Page) {
	await page.evaluate(() => {
		const spacer = document.createElement("div");
		spacer.style.height = "2000px";
		document.getElementById("widgets")?.after(spacer);
	});
}

interface Geometry {
	box: { top: number; left: number; right: number; bottom: number };
	navbarBottom: number;
	contentLeft: number;
	viewportWidth: number;
	viewportHeight: number;
	pinnedBottoms: number[];
}

/// Reads the rectangle of the window and of the bars that must stay on top.
async function geometry(page: Page): Promise<Geometry> {
	return page.evaluate(() => {
		const rect = (element: Element | null) => {
			const r = element?.getBoundingClientRect();
			return {
				top: r?.top ?? 0,
				left: r?.left ?? 0,
				right: r?.right ?? 0,
				bottom: r?.bottom ?? 0,
			};
		};
		const pinned = [
			...document.querySelectorAll<HTMLElement>("[data-shell-bar]"),
		]
			.filter((bar) => getComputedStyle(bar).position === "fixed")
			.map((bar) => bar.getBoundingClientRect().bottom);
		return {
			box: rect(document.querySelector("[data-window-state=maximized]")),
			navbarBottom: rect(document.querySelector(".navbar")).bottom,
			contentLeft: rect(document.getElementById("content")).left,
			viewportWidth: document.documentElement.clientWidth,
			viewportHeight: window.innerHeight,
			pinnedBottoms: pinned,
		};
	});
}

async function expectCoversContentArea(page: Page, index = 0) {
	await expect(win(page, index)).toHaveAttribute(
		"data-window-state",
		"maximized",
	);
	// The view transition may still be running.
	await expect
		.poll(async () => {
			const g = await geometry(page);
			return Math.abs(g.box.bottom - g.viewportHeight) < 1.5;
		})
		.toBe(true);
	const g = await geometry(page);
	expect(g.box.top).toBeGreaterThanOrEqual(g.navbarBottom - 1);
	for (const bottom of g.pinnedBottoms)
		expect(g.box.top).toBeGreaterThanOrEqual(bottom - 1);
	expect(Math.abs(g.box.left - g.contentLeft)).toBeLessThan(1.5);
	expect(Math.abs(g.box.right - g.viewportWidth)).toBeLessThan(1.5);
	expect(Math.abs(g.box.bottom - g.viewportHeight)).toBeLessThan(1.5);
}

test.describe("toolbar of dots (R4, R6, A1)", () => {
	test("three buttons with names, data-action and pressed state", async ({
		page,
	}) => {
		await open(page);
		const bar = toolbar(win(page));
		await expect(bar).toBeVisible();
		const buttons = bar.getByRole("button");
		await expect(buttons).toHaveCount(3);
		await expect(buttons.nth(0)).toHaveAttribute(
			"aria-label",
			t.runner_window_inline,
		);
		await expect(buttons.nth(1)).toHaveAttribute(
			"aria-label",
			t.runner_window_collapse,
		);
		await expect(buttons.nth(2)).toHaveAttribute(
			"aria-label",
			t.runner_window_maximize,
		);
		for (const [i, title] of [
			t.runner_window_inline,
			t.runner_window_collapse,
			t.runner_window_maximize,
		].entries())
			await expect(buttons.nth(i)).toHaveAttribute("title", title);
		await expect(buttons.nth(0)).toHaveAttribute(
			"data-action",
			"window-inline",
		);
		await expect(buttons.nth(1)).toHaveAttribute(
			"data-action",
			"window-collapsed",
		);
		await expect(buttons.nth(2)).toHaveAttribute(
			"data-action",
			"window-maximized",
		);
		// Only red and green carry aria-pressed.
		await expect(buttons.nth(0)).not.toHaveAttribute("aria-pressed", /.*/);
		await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "false");
		await expect(buttons.nth(2)).toHaveAttribute("aria-pressed", "false");
	});

	test("click area is 24x24 px", async ({ page }) => {
		await open(page);
		for (const state of ["inline", "collapsed", "maximized"] as const) {
			const box = await dot(win(page), state).boundingBox();
			expect(box?.width).toBeCloseTo(24, 0);
			expect(box?.height).toBeCloseTo(24, 0);
		}
	});

	test("aria-pressed follows the state", async ({ page }) => {
		await open(page);
		const w = win(page);
		await dot(w, "collapsed").click();
		await expect(dot(w, "collapsed")).toHaveAttribute("aria-pressed", "true");
		await expect(dot(w, "maximized")).toHaveAttribute("aria-pressed", "false");
		await dot(w, "maximized").click();
		await expect(dot(w, "maximized")).toHaveAttribute("aria-pressed", "true");
		await expect(dot(w, "collapsed")).toHaveAttribute("aria-pressed", "false");
	});

	test("exactly one dot is a Tab stop", async ({ page }) => {
		await open(page);
		const tabIndexes = await toolbar(win(page))
			.getByRole("button")
			.evaluateAll((buttons) =>
				buttons.map((b) => (b as HTMLButtonElement).tabIndex),
			);
		expect(tabIndexes.filter((index) => index === 0)).toHaveLength(1);
		expect(tabIndexes.filter((index) => index < 0)).toHaveLength(2);
	});

	test("arrows move the focus, Space and Enter apply, Tab leaves", async ({
		page,
	}) => {
		await open(page);
		const w = win(page);
		await dot(w, "inline").focus();
		await page.keyboard.press("ArrowRight");
		await expect(dot(w, "collapsed")).toBeFocused();
		await page.keyboard.press("ArrowRight");
		await expect(dot(w, "maximized")).toBeFocused();
		await page.keyboard.press("ArrowLeft");
		await expect(dot(w, "collapsed")).toBeFocused();
		await page.keyboard.press("Space");
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await dot(w, "inline").focus();
		await page.keyboard.press("Enter");
		await expect(w).toHaveAttribute("data-window-state", "inline");
		// The stop moved with the focus: Shift+Tab and Tab leave the toolbar.
		await dot(w, "collapsed").focus();
		await page.keyboard.press("Tab");
		const insideAfterTab = await toolbar(w).evaluate((bar) =>
			bar.contains(document.activeElement),
		);
		expect(insideAfterTab).toBe(false);
	});

	test("the dot of the current state has a ring, the others do not", async ({
		page,
	}) => {
		await open(page);
		const w = win(page);
		const shadow = (state: "inline" | "collapsed" | "maximized") =>
			dot(w, state)
				.locator("> span")
				.first()
				.evaluate((el) => getComputedStyle(el).boxShadow);
		await expect.poll(() => shadow("inline")).not.toBe("none");
		expect(await shadow("collapsed")).toBe("none");
		expect(await shadow("maximized")).toBe("none");
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await expect.poll(() => shadow("collapsed")).not.toBe("none");
		expect(await shadow("inline")).toBe("none");
		expect(await shadow("maximized")).toBe("none");
	});
});

test.describe("states (R7, R8, R9, A2)", () => {
	test("starts inline and every dot sets data-window-state", async ({
		page,
	}) => {
		await open(page);
		const w = win(page);
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		await dot(w, "inline").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
	});

	test("clicking the dot of the current state goes back inline", async ({
		page,
	}) => {
		await open(page);
		const w = win(page);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
	});

	test("the state is not kept across loads", async ({ page }) => {
		await open(page);
		await dot(win(page), "maximized").click();
		await expect(win(page)).toHaveAttribute("data-window-state", "maximized");
		await page.reload();
		await expect(win(page)).toHaveAttribute("data-window-state", "inline");
		await dot(win(page), "collapsed").click();
		await page.reload();
		await expect(win(page)).toHaveAttribute("data-window-state", "inline");
		await expect(page.locator("html")).not.toHaveClass(/editor-window-open/);
	});

	test("maximizing a second window returns the first to inline", async ({
		page,
	}) => {
		await open(page);
		await dot(win(page, 0), "maximized").click();
		await expect(win(page, 0)).toHaveAttribute(
			"data-window-state",
			"maximized",
		);
		// The first window covers the second one's dots: a real click cannot
		// reach them, so the click is dispatched on the hidden button.
		await dot(win(page, 1), "maximized").dispatchEvent("click");
		await expect(win(page, 1)).toHaveAttribute(
			"data-window-state",
			"maximized",
		);
		await expect(win(page, 0)).toHaveAttribute("data-window-state", "inline");
		await expect(page.locator("[data-window-state=maximized]")).toHaveCount(1);
		await expect(page.locator("html")).toHaveClass(/editor-window-open/);
	});
});

test.describe("maximized box (R10, R11, R14, R15, A3)", () => {
	test("covers the content area at the top of the page", async ({ page }) => {
		await open(page);
		await dot(win(page), "maximized").click();
		await expectCoversContentArea(page);
	});

	test("covers the content area after the page was scrolled", async ({
		page,
	}) => {
		await open(page);
		await makeScrollable(page);
		await page.evaluate(() => window.scrollTo(0, 120));
		expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
		await dot(win(page), "maximized").click();
		await expectCoversContentArea(page);
	});

	test("pins the sticky breadcrumb and restores its style", async ({
		page,
	}) => {
		await open(page);
		const bar = page.locator("[data-breadcrumbs]");
		await expect(bar).toHaveAttribute("data-shell-bar", /.*/);
		const position = () => bar.evaluate((el) => getComputedStyle(el).position);
		expect(await position()).toBe("sticky");
		const before = await bar.evaluate((el) => el.getAttribute("style") ?? "");
		await dot(win(page), "maximized").click();
		await expect(win(page)).toHaveAttribute("data-window-state", "maximized");
		await expect.poll(position).toBe("fixed");
		const content = await page.evaluate(
			() => document.getElementById("content")?.getBoundingClientRect().left,
		);
		const barBox = await bar.boundingBox();
		expect(Math.abs((barBox?.x ?? -99) - (content ?? 0))).toBeLessThan(1.5);
		await dot(win(page), "maximized").click();
		await expect(win(page)).toHaveAttribute("data-window-state", "inline");
		await expect
			.poll(() => bar.evaluate((el) => el.getAttribute("style") ?? ""))
			.toBe(before);
		expect(await position()).toBe("sticky");
	});

	test("leaves an aria-hidden spacer with the old height", async ({ page }) => {
		await open(page);
		const w = win(page);
		const heightBefore = (await w.boundingBox())?.height ?? 0;
		expect(heightBefore).toBeGreaterThan(50);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		const spacers = await widget(page, 0).evaluate((root) =>
			[...root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')]
				.filter(
					(el) =>
						!el.closest("svg") &&
						el.tagName.toLowerCase() !== "svg" &&
						(el.textContent ?? "").trim() === "" &&
						el.querySelector("button, input, a") === null &&
						el.offsetHeight > 50,
				)
				.map((el) => el.offsetHeight),
		);
		expect(spacers).toHaveLength(1);
		expect(Math.abs((spacers[0] ?? 0) - heightBefore)).toBeLessThan(2);
	});

	test("the text around the window does not move", async ({ page }) => {
		await open(page);
		const neighbour = widget(page, 1);
		const before = (await neighbour.boundingBox())?.y ?? 0;
		await dot(win(page, 0), "maximized").click();
		await expect(win(page, 0)).toHaveAttribute(
			"data-window-state",
			"maximized",
		);
		await expect
			.poll(async () =>
				Math.abs(((await neighbour.boundingBox())?.y ?? 0) - before),
			)
			.toBeLessThan(1.5);
	});

	test("the page behind does not scroll", async ({ page }) => {
		await open(page);
		await makeScrollable(page);
		await expect(page.locator("html")).not.toHaveClass(/editor-window-open/);
		await dot(win(page), "maximized").click();
		await expect(page.locator("html")).toHaveClass(/editor-window-open/);
		expect(
			await page.evaluate(
				() => getComputedStyle(document.documentElement).overflowY,
			),
		).toBe("hidden");
		await dot(win(page), "inline").click();
		await expect(page.locator("html")).not.toHaveClass(/editor-window-open/);
	});

	test("the editor grows to the free height", async ({ page }) => {
		await open(page);
		await setCode(page, 1, SECOND_CODE);
		await dot(win(page, 1), "maximized").click();
		await expect(win(page, 1)).toHaveAttribute(
			"data-window-state",
			"maximized",
		);
		await expect
			.poll(
				async () =>
					(await widget(page, 1).locator(".cm-editor").boundingBox())?.height ??
					0,
			)
			.toBeGreaterThan(400);
	});
});

test.describe("Esc and focus (R16, R17, A6)", () => {
	test("Esc on a dot goes back inline", async ({ page }) => {
		await open(page);
		const w = win(page);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		await dot(w, "collapsed").focus();
		await page.keyboard.press("Escape");
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await expect(page.locator("html")).not.toHaveClass(/editor-window-open/);
	});

	test("Esc with the autocomplete open closes it and stays maximized", async ({
		page,
	}) => {
		await open(page);
		await setCode(page, 1, "const fooBarBaz = 1;\n");
		const w = win(page, 1);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		const content = widget(page, 1).locator(".cm-content");
		await content.click();
		await page.keyboard.press("Control+End");
		await page.keyboard.type("fooB");
		await expect(page.locator(".cm-tooltip-autocomplete")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(page.locator(".cm-tooltip-autocomplete")).toHaveCount(0);
		await expect(w).toHaveAttribute("data-window-state", "maximized");
	});

	test("Esc with extra cursors drops them and stays maximized", async ({
		page,
	}) => {
		await open(page);
		await setCode(page, 0, "a\nb\nc");
		const w = win(page, 0);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		await widget(page, 0).locator(".cm-content").click();
		await page.keyboard.press("Control+End");
		await page.keyboard.press("Shift+Alt+ArrowUp");
		await expect(page.locator(".cm-cursor-secondary")).toHaveCount(1);
		await page.keyboard.press("Escape");
		await expect(page.locator(".cm-cursor-secondary")).toHaveCount(0);
		await expect(w).toHaveAttribute("data-window-state", "maximized");
	});

	test("maximizing focuses the editor", async ({ page }) => {
		await open(page);
		await dot(win(page, 1), "maximized").click();
		await expect(win(page, 1)).toHaveAttribute(
			"data-window-state",
			"maximized",
		);
		await expect(widget(page, 1).locator(".cm-content")).toBeFocused();
	});

	test("going back from a dot leaves the focus on the dot of the new state", async ({
		page,
	}) => {
		await open(page);
		const w = win(page);
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await expect(dot(w, "collapsed")).toBeFocused();
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await expect(dot(w, "inline")).toBeFocused();
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await expect(dot(w, "inline")).toBeFocused();
	});
});

test.describe("collapsed (R19, A4, A5)", () => {
	test("code and undo history survive collapse and maximize", async ({
		page,
	}) => {
		await open(page);
		await setCode(page, 1, SECOND_CODE);
		const w = win(page, 1);
		const content = widget(page, 1).locator(".cm-content");
		await content.click();
		await page.keyboard.press("Control+End");
		await page.keyboard.type(" //XYZ");
		await expect(content).toContainText("//XYZ");

		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await expect(content).toContainText("//XYZ");

		await content.click();
		await page.keyboard.press("Control+z");
		await expect(content).not.toContainText("//XYZ");
		await expect(content).toContainText("second");
	});

	test("collapsed hides the editor without unmounting it", async ({ page }) => {
		await open(page);
		await setCode(page, 1, SECOND_CODE);
		const w = win(page, 1);
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await expect.poll(() => codeIsHidden(widget(page, 1))).toBe(true);
		await expect(widget(page, 1).locator(".cm-editor")).toHaveCount(1);
		await expect(toolbar(w)).toBeVisible();
	});

	test("Run while collapsed shows the output and keeps the editor hidden", async ({
		page,
	}) => {
		await open(page);
		const w = widget(page, 1);
		await dot(win(page, 1), "collapsed").click();
		await expect(win(page, 1)).toHaveAttribute(
			"data-window-state",
			"collapsed",
		);
		await w.locator("[data-action=run]").click();
		await expect(terminalText(w)).toContainText("second");
		await expect(w.locator("[data-terminal]")).toBeVisible();
		await expect.poll(() => codeIsHidden(w)).toBe(true);
		await expect(win(page, 1)).toHaveAttribute(
			"data-window-state",
			"collapsed",
		);
	});
});

test.describe("title bar (R3)", () => {
	test("Run is a play button in the title bar, above the code", async ({
		page,
	}) => {
		await open(page);
		const w = widget(page, 1);
		const run = w.locator("[data-action=run]");
		await expect(run).toHaveCount(1);
		await expect(run).toHaveAttribute("aria-label", t.runner_run);
		await expect(run).toHaveAttribute("title", t.runner_run_hint);
		const bar = toolbar(win(page, 1)).locator("xpath=..");
		await expect(bar.locator("[data-action=run]")).toHaveCount(1);
		const runBox = await run.boundingBox();
		const codeBox = await w
			.locator("[data-editor-static], [data-editor]")
			.first()
			.boundingBox();
		expect((runBox?.y ?? 1e9) + (runBox?.height ?? 0)).toBeLessThanOrEqual(
			(codeBox?.y ?? 0) + 1,
		);
		await expect(w.locator(".btn-circle")).toHaveCount(0);
	});

	test("Stop replaces Run in the title bar while running", async ({ page }) => {
		await open(page);
		await setCode(page, 1, "while (true) {}");
		const w = widget(page, 1);
		await w.locator("[data-action=run]").click();
		await expect(w).toHaveAttribute("data-phase", "running");
		const stop = w.locator("[data-action=stop]");
		await expect(stop).toHaveAttribute("aria-label", t.runner_stop);
		await expect(
			toolbar(win(page, 1)).locator("xpath=..").locator("[data-action=stop]"),
		).toHaveCount(1);
		await stop.click();
		await expect(w).toHaveAttribute("data-phase", "stopped", { timeout: 3000 });
		await expect(w.locator("[data-action=run]")).toBeFocused();
	});
});

test.describe("view transitions (R23, R24, A8)", () => {
	const spy = async (page: Page) =>
		page.addInitScript(() => {
			const w = window as unknown as { __transitions: number };
			w.__transitions = 0;
			const original = document.startViewTransition?.bind(document);
			if (!original) return;
			document.startViewTransition = ((
				callback?: ViewTransitionUpdateCallback,
			) => {
				w.__transitions++;
				return original(callback);
			}) as typeof document.startViewTransition;
		});
	const count = (page: Page) =>
		page.evaluate(
			() => (window as unknown as { __transitions: number }).__transitions,
		);

	test("with reduced motion no view transition starts and the result is the same", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "reduce" });
		await spy(page);
		await open(page);
		const w = win(page);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		await expectCoversContentArea(page);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		expect(await count(page)).toBe(0);
	});

	test("entering and leaving maximized uses a view transition", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await spy(page);
		await open(page);
		test.skip(
			!(await page.evaluate(() => "startViewTransition" in document)),
			"the browser has no view transitions",
		);
		const w = win(page);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		expect(await count(page)).toBe(1);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
		expect(await count(page)).toBe(2);
	});

	test("inline to collapsed is a CSS transition, not a view transition", async ({
		page,
	}) => {
		await page.emulateMedia({ reducedMotion: "no-preference" });
		await spy(page);
		await open(page);
		await dot(win(page), "collapsed").click();
		await expect(win(page)).toHaveAttribute("data-window-state", "collapsed");
		expect(await count(page)).toBe(0);
	});
});

test.describe("review findings", () => {
	test("a second window maximized after the first covers the area and keeps the breadcrumb pinned", async ({
		page,
	}) => {
		await open(page);
		const bar = page.locator("[data-breadcrumbs]");
		const position = () => bar.evaluate((el) => getComputedStyle(el).position);
		const before = await bar.evaluate((el) => el.getAttribute("style") ?? "");
		await dot(win(page, 0), "maximized").click();
		await expect(win(page, 0)).toHaveAttribute(
			"data-window-state",
			"maximized",
		);
		// The first window hides the second one's dots: dispatch the click.
		await dot(win(page, 1), "maximized").dispatchEvent("click");
		await expect(win(page, 1)).toHaveAttribute(
			"data-window-state",
			"maximized",
		);
		await expect(win(page, 0)).toHaveAttribute("data-window-state", "inline");
		await expectCoversContentArea(page, 1);
		await expect.poll(position).toBe("fixed");
		await dot(win(page, 1), "maximized").click();
		await expect(win(page, 1)).toHaveAttribute("data-window-state", "inline");
		await expect
			.poll(() => bar.evaluate((el) => el.getAttribute("style") ?? ""))
			.toBe(before);
		expect(await position()).toBe("sticky");
	});

	test("two fast clicks on the green dot keep the spacer at the inline height", async ({
		page,
	}) => {
		await open(page);
		const w = win(page, 0);
		const heightBefore = (await w.boundingBox())?.height ?? 0;
		await dot(w, "maximized").evaluate((button) => {
			(button as HTMLButtonElement).click();
			(button as HTMLButtonElement).click();
		});
		await page.waitForTimeout(600);
		const spacers = await widget(page, 0).evaluate((root) =>
			[...root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')]
				.filter(
					(el) =>
						el.tagName.toLowerCase() !== "svg" &&
						!el.closest("svg") &&
						(el.textContent ?? "").trim() === "" &&
						el.querySelector("button, input, a") === null &&
						el.offsetHeight > 50,
				)
				.map((el) => el.offsetHeight),
		);
		for (const height of spacers)
			expect(Math.abs(height - heightBefore)).toBeLessThan(2);
		const state = await w.getAttribute("data-window-state");
		expect(spacers).toHaveLength(state === "maximized" ? 1 : 0);
	});

	test("resizing the viewport while maximized still covers the content area", async ({
		page,
	}) => {
		await open(page);
		await dot(win(page), "maximized").click();
		await expectCoversContentArea(page);
		await page.setViewportSize({ width: 1180, height: 640 });
		await expectCoversContentArea(page);
		await page.setViewportSize({ width: 1440, height: 900 });
		await expectCoversContentArea(page);
	});

	test("Esc on a title bar action goes back inline", async ({ page }) => {
		await open(page);
		const w = win(page, 0);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		await widget(page, 0).locator("[data-action=run]").focus();
		await expect(widget(page, 0).locator("[data-action=run]")).toBeFocused();
		await page.keyboard.press("Escape");
		await expect(w).toHaveAttribute("data-window-state", "inline");
	});

	test("while maximized the content outside the window is inert and Tab stays out of it", async ({
		page,
	}) => {
		await open(page);
		const inertCount = () =>
			page.evaluate(() => document.querySelectorAll("#content [inert]").length);
		const before = await inertCount();
		const w = win(page, 0);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		// The second snippet lies behind the window.
		await expect
			.poll(() =>
				widget(page, 1).evaluate((el) => el.closest("[inert]") !== null),
			)
			.toBe(true);
		const escaped: string[] = [];
		for (let i = 0; i < 30; i++) {
			await page.keyboard.press(i < 20 ? "Tab" : "Shift+Tab");
			const outside = await page.evaluate(() => {
				const active = document.activeElement;
				const win = document.querySelector("[data-window-state=maximized]");
				if (!active || !win) return null;
				const inContent = active.closest("#content") !== null;
				const allowed =
					win.contains(active) || active.closest("[data-shell-bar]") !== null;
				return inContent && !allowed ? active.outerHTML.slice(0, 80) : null;
			});
			if (outside) escaped.push(outside);
		}
		expect(escaped).toEqual([]);
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await expect.poll(inertCount).toBe(before);
	});
});
