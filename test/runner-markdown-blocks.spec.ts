import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { highlightRunnerBlocks, renderMarkdown } from "@/utils/markdown";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

test.describe("rendering", () => {
	test("a js run block becomes a runner block with its language", () => {
		const html = renderMarkdown("```js run\nconsole.log(1)\n```\n");
		expect(html).toContain(
			'<div class="code-runner-block" data-language="javascript"><pre><code>console.log(1)\n</code></pre></div>',
		);
	});

	test("a block without run stays a plain code block", () => {
		const html = renderMarkdown("```js\nconsole.log(1)\n```\n");
		expect(html).not.toContain("code-runner");
		expect(html).toContain("<pre><code");
	});

	test("a run block without a driver is static with a note", () => {
		const html = renderMarkdown("```haskell run\nmain = pure ()\n```\n");
		expect(html).not.toContain("code-runner-block");
		expect(html).toMatch(
			/<div class="code-runner-unavailable"><pre><code>main = pure \(\)\n<\/code><\/pre><p [^>]*>[^<]+<\/p><\/div>/,
		);
	});

	test("script tags in the block come out escaped", () => {
		const html = renderMarkdown("```js run\n<script>alert(1)</script>\n```\n");
		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
	});

	test("the info string never reaches an attribute", () => {
		const html = renderMarkdown('```js" onload="x run\ncode\n```\n');
		expect(html).not.toContain("onload=");
		expect(renderMarkdown('```js run" onload="x\ncode\n```\n')).not.toContain(
			"onload=",
		);
	});
});

test.describe("highlighting", () => {
	test("the static view uses the dark palette in both site themes", async () => {
		const html = await highlightRunnerBlocks(
			renderMarkdown('```js run\nconst x = "a"; // c\n```\n'),
		);
		const pairs = [
			...html.matchAll(/--shiki-light:(#\w+);--shiki-dark:(#\w+)/g),
		];
		expect(pairs.length).toBeGreaterThan(0);
		for (const [, light, dark] of pairs) expect(light).toBe(dark);
	});
});

test.describe("page", () => {
	test.beforeEach(resetDatabase);

	test("run blocks run and share one iframe, the others stay static", async ({
		page,
	}) => {
		const student = await seedUser({ role: "STUDENT" });
		const course = await persistedCourseFactory.create();
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		await db.resource.create(
			{
				course: course.id,
				slug: "notes",
				title: "Notes",
				data: {
					type: "MD",
					content: [
						"```js run",
						'console.log("first-out");',
						"```",
						"",
						"```js run",
						'console.log("second-out");',
						"```",
						"",
						"```js",
						"static();",
						"```",
						"",
						"```haskell run",
						"main = pure ()",
						"```",
					].join("\n"),
				},
			},
			FULL_ACCESS,
		);
		const href = courseHref({
			discipline: course.discipline.slug,
			instructor: course.instructor.username,
			edition: course.edition.slug,
		});
		await logInAs(page, student);
		await page.goto(`${href}/resources/notes`);
		await page.bringToFront();

		const widgets = page.locator("[data-code-runner]");
		await expect(widgets).toHaveCount(2);
		await widgets.nth(0).locator("[data-action=run]").click();
		await widgets.nth(1).locator("[data-action=run]").click();
		await expect(
			widgets.nth(0).locator("[data-terminal] .xterm-accessibility-tree"),
		).toContainText("first-out", { timeout: 20_000 });
		// xterm renders nothing while its terminal is outside the viewport.
		await widgets.nth(1).scrollIntoViewIfNeeded();
		await expect(
			widgets.nth(1).locator("[data-terminal] .xterm-accessibility-tree"),
		).toContainText("second-out", { timeout: 20_000 });
		await expect(page.locator("iframe[data-runner-frame]")).toHaveCount(1);

		// Each block has its own file name, the terminal fits its output, and
		// the widgets do not touch.
		await expect(
			widgets.nth(0).locator("[data-editor-static]"),
		).toHaveAttribute("aria-label", /block-1\.js/);
		await expect(
			widgets.nth(1).locator("[data-editor-static]"),
		).toHaveAttribute("aria-label", /block-2\.js/);
		const terminalBox = await widgets
			.nth(0)
			.locator("[data-terminal]")
			.boundingBox();
		expect(terminalBox?.height).toBeLessThan(100);
		const first = await widgets.nth(0).boundingBox();
		const second = await widgets.nth(1).boundingBox();
		expect(
			(second?.y ?? 0) - ((first?.y ?? 0) + (first?.height ?? 0)),
		).toBeGreaterThanOrEqual(12);

		const staticBlock = page.locator("pre", { hasText: "static();" });
		await expect(staticBlock).toBeVisible();
		await expect(staticBlock.locator("xpath=..")).not.toHaveClass(
			/code-runner/,
		);
		const unavailable = page.locator(".code-runner-unavailable");
		await expect(unavailable).toHaveCount(1);
		await expect(unavailable.locator("button")).toHaveCount(0);
		await expect(unavailable.locator("p")).not.toBeEmpty();
	});
});
