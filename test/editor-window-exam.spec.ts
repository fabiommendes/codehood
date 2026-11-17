import { readFileSync } from "node:fs";
import path from "node:path";
import { parseQuestion, resolveTests } from "mdq";
import { FULL_ACCESS } from "@/auth/actor";
import type { CourseId } from "@/core/schemas/base";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { sumCode } from "@/mdq/fixtures";
import { courseHref } from "@/urls";
import { expect, type Locator, type Page, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The editor window in an exam attempt: the essay with code (`CodeRunner` in
// `answer` mode) and the MDQ `code` question (`CodeAnswer`). The window in
// snippet mode is covered by `editor-window.spec.ts`.

test.beforeEach(resetDatabase);
test.use({ viewport: { width: 1440, height: 900 } });

/// The runner messages of the locale the test server is built for.
const t: Record<
	| "runner_window_label"
	| "runner_window_inline"
	| "runner_window_collapse"
	| "runner_window_maximize"
	| "runner_window_stem_show"
	| "runner_window_stem_hide",
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

const ANSWER_ACTION = "**/_actions/exam.answer**";
const STEM = "Print the sum of 1 and 2.";
const EPILOGUE = "Remember to print the result.";
const EXAMPLE_DIR = path.join(
	process.cwd(),
	"workers/chalk-worker/example/questions/elm",
);

type Kind = "essay" | "code";

interface Prepared {
	url: string;
	course: { id: CourseId };
	exam: { slug: string };
	student: { username: string };
	attempt: { publicId: string };
}

/// A student in an open attempt at an exam with one code question of `kind`: a JavaScript essay, or the Python `sumCode` question (with a grader when `grader`).
async function setup(
	page: Page,
	kind: Kind,
	options: {
		grader?: boolean;
		question?: "sum" | "elm";
		type?: "EXAM" | "QUIZ";
	} = {},
): Promise<Prepared> {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slug = kind === "essay" ? "code" : "task";
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug,
			question:
				kind === "essay"
					? {
							type: "essay",
							content: "code",
							highlight: "javascript",
							stem: STEM,
							epilogue: EPILOGUE,
							tags: [],
						}
					: options.question === "elm"
						? elmQuestion()
						: options.grader
							? { ...sumCode, meta: { worker: "py-test", attempts: 3 } }
							: sumCode,
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "window-exam",
		type: options.type ?? (kind === "essay" ? "EXAM" : "QUIZ"),
		status: "ONGOING",
		duration: { minutes: 30 },
		questions: [{ slug }],
	});
	const attempt = await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await logInAs(page, student);
	return {
		url: `${href}/exams/${exam.slug}`,
		course,
		exam,
		student,
		attempt,
	};
}

/// The Elm example question, with its test sources read from disk.
function elmQuestion() {
	const parsed = parseQuestion(
		readFileSync(path.join(EXAMPLE_DIR, "soma.md"), "utf8"),
	);
	if (parsed.type !== "code") throw new Error("soma.md is not a code question");
	const texts = Object.fromEntries(
		(parsed.tests ?? []).flatMap((source) =>
			source.origin
				? [
						[
							source.origin,
							readFileSync(path.join(EXAMPLE_DIR, source.origin), "utf8"),
						],
					]
				: [],
		),
	);
	return resolveTests(parsed, texts);
}

const win = (page: Page) => page.locator("[data-window-state]");
const titleBar = (w: Locator) => w.locator("> header");
const toolbar = (w: Locator) =>
	w.getByRole("toolbar", { name: t.runner_window_label });
const dot = (w: Locator, state: "inline" | "collapsed" | "maximized") =>
	w.locator(`[data-action=window-${state}]`);
const content = (w: Locator) => w.locator(".cm-content");
const examBar = (page: Page) =>
	page
		.locator("[data-shell-bar]")
		.filter({ has: page.locator("a[href^='#question-']") });

async function open(
	page: Page,
	kind: Kind,
	grader = false,
	type?: "EXAM" | "QUIZ",
) {
	const s = await setup(page, kind, { grader, type });
	await page.goto(s.url);
	await expect(win(page)).toHaveCount(1);
	await expect(win(page)).toHaveAttribute("data-window-state", "inline");
	await expect(content(win(page))).toBeVisible();
	return s;
}

async function maximize(page: Page) {
	await dot(win(page), "maximized").click();
	await expect(win(page)).toHaveAttribute("data-window-state", "maximized");
	// The view transition's overlay covers the page until it ends.
	await expect
		.poll(() =>
			page.evaluate(() => {
				try {
					return document.documentElement.matches(":active-view-transition");
				} catch {
					return false;
				}
			}),
		)
		.toBe(false);
}

async function box(locator: Locator) {
	const b = await locator.boundingBox();
	if (!b) throw new Error("element has no box");
	return { ...b, right: b.x + b.width, bottom: b.y + b.height };
}

/// Fails unless `inner` lies inside `outer`.
async function expectInside(inner: Locator, outer: Locator) {
	await expect(inner).toBeVisible();
	const i = await box(inner);
	const o = await box(outer);
	expect(i.x).toBeGreaterThanOrEqual(o.x - 1);
	expect(i.y).toBeGreaterThanOrEqual(o.y - 1);
	expect(i.right).toBeLessThanOrEqual(o.right + 1);
	expect(i.bottom).toBeLessThanOrEqual(o.bottom + 1);
}

/// Whether the code view is cut away: it, or an ancestor inside the window that clips it, has no height left.
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
		return [...root.querySelectorAll(".cm-editor")].every(clipped);
	});
}

/// The code the server holds for the essay answer, or null.
async function savedCode(s: Prepared): Promise<string | null> {
	const [attempt] = await db.response.findMany(
		{ course: s.course.id, exam: s.exam.slug, author: s.student.username },
		FULL_ACCESS,
	);
	const payload = attempt?.submissions.at(-1)?.payload;
	return typeof payload === "string" ? payload : null;
}

/// Lets the edit monitor open its field, so the first edits are recorded.
async function monitorReady(page: Page) {
	await expect
		.poll(() =>
			page.evaluate(async () =>
				(await indexedDB.databases()).some((entry) =>
					entry.name?.includes("codehood-answer-edits"),
				),
			),
		)
		.toBe(true);
	await page.waitForTimeout(300);
}

/// Hides the page and shows it again: the page flushes its history when it is hidden.
async function flushHistory(page: Page): Promise<void> {
	await page.evaluate(() => {
		const state = (value: DocumentVisibilityState) =>
			Object.defineProperty(document, "visibilityState", {
				configurable: true,
				get: () => value,
			});
		state("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		state("visible");
	});
}

/// How many history batches the server holds for the attempt.
const batchCount = (s: Prepared) =>
	prisma.answerEditBatch.count({
		where: {
			field: { history: { response: { publicId: s.attempt.publicId } } },
		},
	});

const KINDS: Kind[] = ["essay", "code"];

for (const kind of KINDS) {
	test.describe(`dots in the ${kind} answer (A1)`, () => {
		test("three named buttons in a toolbar, one Tab stop, ring on the current state", async ({
			page,
		}) => {
			await open(page, kind);
			const w = win(page);
			const bar = toolbar(w);
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
			await expect(buttons.nth(0)).not.toHaveAttribute("aria-pressed", /.*/);
			await expect(buttons.nth(1)).toHaveAttribute("aria-pressed", "false");
			await expect(buttons.nth(2)).toHaveAttribute("aria-pressed", "false");

			const tabIndexes = await buttons.evaluateAll((all) =>
				all.map((b) => (b as HTMLButtonElement).tabIndex),
			);
			expect(tabIndexes.filter((index) => index === 0)).toHaveLength(1);

			const ring = (state: "inline" | "collapsed" | "maximized") =>
				dot(w, state)
					.locator("> span")
					.first()
					.evaluate((el) => getComputedStyle(el).boxShadow);
			await expect.poll(() => ring("inline")).not.toBe("none");
			expect(await ring("maximized")).toBe("none");
		});

		test("the window is named by its file", async ({ page }) => {
			await open(page, kind);
			await expect(titleBar(win(page))).toContainText(
				kind === "essay" ? /\.js|javascript/i : "sum.py",
			);
		});
	});
}

test.describe("title bar actions (R2, R3)", () => {
	test("essay: play in the title bar, no run button anywhere else", async ({
		page,
	}) => {
		await open(page, "essay");
		const w = win(page);
		await expect(titleBar(w).locator("[data-action=run]")).toBeVisible();
		await expect(page.locator("[data-action=run]")).toHaveCount(1);
		const run = titleBar(w).locator("[data-action=run]");
		await expect(run).toHaveAttribute("aria-label", "Run");
		await expect(run).toHaveAttribute("title", /Ctrl\+Enter/);
		await expect(run).toHaveClass(/btn-square/);
	});

	test("code: no play, pretests then submit in the title bar", async ({
		page,
	}) => {
		await open(page, "code", true);
		const w = win(page);
		await expect(page.locator("[data-action=run]")).toHaveCount(0);
		const actions = await titleBar(w)
			.locator("[data-action=run-pretests], [data-action=submit]")
			.evaluateAll((all) => all.map((el) => el.getAttribute("data-action")));
		expect(actions).toEqual(["run-pretests", "submit"]);
		// No copy of either button left outside the window.
		await expect(page.locator("[data-action=run-pretests]")).toHaveCount(1);
		await expect(page.locator("[data-action=submit]")).toHaveCount(1);
		await expect(
			titleBar(w).locator("[data-action=run-pretests]"),
		).toHaveAttribute("title", /Run pretests.*Ctrl\+Enter/);
		await expect(titleBar(w).locator("[data-action=submit]")).toHaveClass(
			/btn-outline/,
		);
	});

	test("code without a grader has pretests and no submit", async ({ page }) => {
		await open(page, "code", false);
		const w = win(page);
		await expect(
			titleBar(w).locator("[data-action=run-pretests]"),
		).toBeVisible();
		await expect(page.locator("[data-action=submit]")).toHaveCount(0);
	});
});

test.describe("maximized in the exam (R11, A3, A7)", () => {
	for (const kind of KINDS) {
		test(`${kind}: the exam bar stays above the window, as wide as it, content in place`, async ({
			page,
		}) => {
			await open(page, kind);
			const bar = examBar(page);
			await expect(bar).toBeVisible();
			const style = await bar.evaluate((el) => el.getAttribute("style") ?? "");
			const timer = bar.locator(".tabular-nums").first();
			const before = await box(timer);
			const stemBefore = await box(page.locator(".mdq-stem").first());

			await maximize(page);
			const w = win(page);
			await expect
				.poll(() => bar.evaluate((el) => getComputedStyle(el).position))
				.toBe("fixed");
			await expect(bar).toBeVisible();
			await expect(timer).toHaveText(/\d+ min/);
			await expect(bar.locator("a[href^='#question-']").first()).toBeVisible();

			await expect
				.poll(async () => {
					const b = await box(bar);
					const o = await box(w);
					return (
						Math.abs(b.x - o.x) < 1.5 &&
						Math.abs(b.right - o.right) < 1.5 &&
						o.y >= b.bottom - 1
					);
				})
				.toBe(true);
			// Only the background widens: the timer stays on the same pixel column.
			await expect
				.poll(async () => Math.abs((await box(timer)).x - before.x))
				.toBeLessThan(1.5);
			// The bar is not under the window.
			const onTop = await bar.evaluate((el) => {
				const r = el.getBoundingClientRect();
				const hit = document.elementFromPoint(
					r.left + r.width / 2,
					r.top + r.height / 2,
				);
				return hit !== null && el.contains(hit);
			});
			expect(onTop).toBe(true);
			// The text above the window does not move.
			await expect
				.poll(async () =>
					Math.abs(
						(await box(page.locator(".mdq-stem").first())).y - stemBefore.y,
					),
				)
				.toBeLessThan(1.5);

			await dot(w, "inline").click();
			await expect(w).toHaveAttribute("data-window-state", "inline");
			await expect
				.poll(() => bar.evaluate((el) => el.getAttribute("style") ?? ""))
				.toBe(style);
		});
	}
});

test.describe("maximized window contents (R12, A7)", () => {
	test("essay: the saved-at footer is inside the window", async ({ page }) => {
		const s = await open(page, "essay");
		const w = win(page);
		await maximize(page);
		const footer = w.locator("[data-code-footer]");
		await expect(page.locator("[data-code-footer]")).toHaveCount(1);
		await content(w).fill("console.log(3)");
		await expect.poll(() => savedCode(s)).toBe("console.log(3)");
		await expect(footer).toContainText(/Saved at \d\d:\d\d/);
		await expectInside(footer, w);
	});

	test("code: pretest report area, hint and submit status are inside the window", async ({
		page,
	}) => {
		await open(page, "code", true);
		const w = win(page);
		await maximize(page);
		for (const hook of [
			"[data-pretest-result]",
			"[data-pretest-hint]",
			"[data-submit-status]",
		]) {
			await expect(page.locator(hook)).toHaveCount(1);
			await expect(w.locator(hook)).toHaveCount(1);
		}
		await expectInside(w.locator("[data-submit-status]"), w);
		await expect(w.locator("[data-submit-count]")).toContainText("0 of 3");
	});

	test("code: the submit result is inside the window and the sends list below it", async ({
		page,
	}) => {
		await open(page, "code", true);
		const w = win(page);
		await maximize(page);
		await content(w).click();
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.insertText("\n# sent from the window");
		await titleBar(w).locator("[data-action=submit]").click();
		const status = w.locator("[data-submit-status]");
		await expect(status).toHaveAttribute("data-submit-status", "sent");
		await expectInside(status, w);
		await expect(page.locator("[data-sends]")).toHaveCount(1);
		await expect(w.locator("[data-sends]")).toHaveCount(0);
		await dot(w, "inline").click();
		await expect(page.locator("[data-sends]")).toBeVisible();
	});

	test("code: the pretest report is inside the window", async ({ page }) => {
		test.setTimeout(240_000);
		const s = await setup(page, "code", { question: "elm" });
		await page.goto(s.url);
		const w = win(page);
		await expect(content(w)).toBeVisible();
		await maximize(page);
		await titleBar(w).locator("[data-action=run-pretests]").click();
		const report = w.locator("[data-pretest-result] [data-status]");
		await expect(report).toBeVisible({ timeout: 150_000 });
		// The output is capped at 30% of the window and scrolls (R12): the
		// output area lies inside the window and holds the report.
		await expectInside(w.locator("[data-window-below]"), w);
		await expect(
			w.locator("[data-window-below] [data-pretest-result]"),
		).toHaveCount(1);
	});
});

test.describe("question panel when maximized (R13)", () => {
	for (const kind of KINDS) {
		test(`${kind}: absent inline, shown maximized, toggled by the button`, async ({
			page,
		}) => {
			await open(page, kind);
			const w = win(page);
			const stem = w.locator(".mdq-stem");
			await expect(stem).toHaveCount(0);
			await expect(
				w.getByRole("button", { name: t.runner_window_stem_hide, exact: true }),
			).toHaveCount(0);
			await expect(
				w.getByRole("button", { name: t.runner_window_stem_show, exact: true }),
			).toHaveCount(0);

			await maximize(page);
			await expect(stem).toBeVisible();
			await expectInside(stem, w);
			if (kind === "essay")
				await expect(w.locator(".mdq-epilogue")).toBeVisible();
			else await expect(w.locator("[data-code-examples]")).toBeVisible();

			const hide = w.getByRole("button", {
				name: t.runner_window_stem_hide,
				exact: true,
			});
			await expect(hide).toHaveAttribute("aria-expanded", "true");
			await hide.click();
			await expect(stem).toHaveCount(0);
			const show = w.getByRole("button", {
				name: t.runner_window_stem_show,
				exact: true,
			});
			await expect(show).toHaveAttribute("aria-expanded", "false");
			await show.click();
			await expect(stem).toBeVisible();

			await dot(w, "inline").click();
			await expect(w.locator(".mdq-stem")).toHaveCount(0);
		});
	}
});

test.describe("collapsed (R19, R20, A5)", () => {
	test("essay: the title bar stays, running shows the output without opening the editor", async ({
		page,
	}) => {
		await open(page, "essay");
		const w = win(page);
		await content(w).fill('console.log("ran while collapsed")');
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await expect.poll(() => codeIsHidden(w)).toBe(true);
		await expect(titleBar(w).locator("[data-action=run]")).toBeVisible();

		await titleBar(w).locator("[data-action=run]").click();
		const terminal = w.locator("[data-terminal] .xterm-accessibility-tree");
		await expect(terminal).toContainText("ran while collapsed", {
			timeout: 60_000,
		});
		await expect(w.locator("[data-terminal]")).toBeVisible();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		expect(await codeIsHidden(w)).toBe(true);
	});

	test("code: running the pretests shows the report without opening the editor", async ({
		page,
	}) => {
		test.setTimeout(240_000);
		const s = await setup(page, "code", { question: "elm" });
		await page.goto(s.url);
		const w = win(page);
		await expect(content(w)).toBeVisible();
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await expect.poll(() => codeIsHidden(w)).toBe(true);

		await titleBar(w).locator("[data-action=run-pretests]").click();
		const report = w.locator("[data-pretest-result] [data-status]");
		await expect(report).toBeVisible({ timeout: 150_000 });
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		expect(await codeIsHidden(w)).toBe(true);
	});
});

test.describe("collapsed, status the student must see (R20)", () => {
	/// Fails unless `locator` is shown below the title bar of `w`, with height and not inert.
	async function expectShownBelowBar(w: Locator, locator: Locator) {
		await expect(locator).toBeVisible();
		const bar = await box(titleBar(w));
		const b = await box(locator);
		expect(b.height).toBeGreaterThan(5);
		expect(b.y).toBeGreaterThanOrEqual(bar.bottom - 1);
		expect(await locator.evaluate((el) => el.closest("[inert]") === null)).toBe(
			true,
		);
	}

	test("code: submitting with the window collapsed shows the result below the bar", async ({
		page,
	}) => {
		await open(page, "code", true);
		const w = win(page);
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await expect.poll(() => codeIsHidden(w)).toBe(true);

		await titleBar(w).locator("[data-action=submit]").click();
		const status = w.locator("[data-submit-status]");
		await expect(status).toHaveAttribute("data-submit-status", "sent");
		await expectShownBelowBar(w, status);
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		expect(await codeIsHidden(w)).toBe(true);
	});

	test("essay: a failing save shows its notice below the bar when collapsed", async ({
		page,
	}) => {
		await open(page, "essay");
		const w = win(page);
		await page.route(ANSWER_ACTION, (route) => route.abort());
		await content(w).fill("console.log('not saved')");
		const failing = w.locator("[data-save=failing]");
		await expect(failing).toBeVisible();

		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		await expect.poll(() => codeIsHidden(w)).toBe(true);
		await expectShownBelowBar(w, failing);
	});
});

test("code: Ctrl+Enter in the editor runs the pretests", async ({ page }) => {
	test.setTimeout(240_000);
	const s = await setup(page, "code", { question: "elm" });
	await page.goto(s.url);
	const w = win(page);
	await content(w).click();
	await page.keyboard.press("ControlOrMeta+Enter");
	await expect(w.locator("[data-pretest-result] [data-status]")).toBeVisible({
		timeout: 150_000,
	});
});

test.describe("code survives the window states (A4)", () => {
	for (const via of ["collapsed", "maximized"] as const) {
		test(`essay: typed code and Ctrl+Z survive ${via}`, async ({ page }) => {
			await open(page, "essay");
			const w = win(page);
			await content(w).click();
			await page.keyboard.insertText("alpha();");
			await expect(content(w)).toContainText("alpha();");

			await dot(w, via).click();
			await expect(w).toHaveAttribute("data-window-state", via);
			await dot(w, via).click();
			await expect(w).toHaveAttribute("data-window-state", "inline");
			await expect(content(w)).toContainText("alpha();");

			await content(w).click();
			await page.keyboard.press("ControlOrMeta+Z");
			await expect(content(w)).not.toContainText("alpha();");
		});
	}

	test("code question: typed code and Ctrl+Z survive maximizing", async ({
		page,
	}) => {
		await open(page, "code");
		const w = win(page);
		await content(w).click();
		await page.keyboard.press("ControlOrMeta+End");
		await page.keyboard.insertText("\n# marker");
		await expect(content(w)).toContainText("# marker");
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "maximized");
		await dot(w, "maximized").click();
		await expect(w).toHaveAttribute("data-window-state", "inline");
		await expect(content(w)).toContainText("# marker");
		await content(w).click();
		await page.keyboard.press("ControlOrMeta+Z");
		await expect(content(w)).not.toContainText("# marker");
	});
});

test.describe("no save, no history from the window states (R21, A9)", () => {
	for (const kind of KINDS) {
		test(`${kind}: collapsing and maximizing sends no save and adds no edit history`, async ({
			page,
		}) => {
			const s = await open(page, kind, false, "EXAM");
			const w = win(page);
			await monitorReady(page);
			await content(w).fill("console.log('before')");
			await expect.poll(() => savedCode(s)).toBe("console.log('before')");
			await flushHistory(page);
			await expect
				.poll(() => batchCount(s), { timeout: 20_000 })
				.toBeGreaterThan(0);
			const batches = await batchCount(s);

			const requests: string[] = [];
			await page.route(ANSWER_ACTION, (route) => {
				requests.push(route.request().url());
				return route.continue();
			});
			await page.route("**/_actions/answerHistory.**", (route) => {
				requests.push(route.request().url());
				return route.continue();
			});

			for (const state of [
				"collapsed",
				"inline",
				"maximized",
				"inline",
			] as const) {
				await dot(w, state).click();
				await expect(w).toHaveAttribute("data-window-state", state);
			}
			await page.waitForTimeout(2500);
			await flushHistory(page);
			await page.waitForTimeout(1000);

			expect(requests).toEqual([]);
			expect(await batchCount(s)).toBe(batches);
			expect(await savedCode(s)).toBe("console.log('before')");
		});
	}

	test("a collapsed answer is still saved", async ({ page }) => {
		const s = await open(page, "essay");
		const w = win(page);
		await content(w).click();
		await dot(w, "collapsed").click();
		await expect(w).toHaveAttribute("data-window-state", "collapsed");
		// The answer typed while inline is saved with the window collapsed.
		await dot(w, "inline").click();
		await content(w).fill("console.log('kept')");
		await dot(w, "collapsed").click();
		await expect.poll(() => savedCode(s)).toBe("console.log('kept')");
	});
});
