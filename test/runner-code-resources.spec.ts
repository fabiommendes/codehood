import { expect, type Locator, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The editor of a CODE resource highlights every language with a driver, with
// the colors and the place the code had in the read-only view.

test.beforeEach(resetDatabase);

const SOURCES = {
	lua: 'local greeting = "hi" -- comment\nprint(greeting, 42)\n',
	typescript:
		'const greeting: string = "hi"; // comment\nconsole.log(greeting, 42);\n',
	python: 'def greeting(): return "hi"  # comment\nprint(greeting(), 42)\n',
	prolog: "greeting(X) :- X = 'hi', !. % comment\n:- initialization(main).\n",
	elm: 'module Main exposing (..)\n\ngreeting : String\ngreeting = "hi" -- comment\n',
} as const;

/// The color of each visible character of the code under `root`, skipping line numbers.
const charColors = (root: Locator) =>
	root.evaluate((element) => {
		const colors: string[] = [];
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			const parent = node.parentElement;
			if (!parent || parent.closest(".cm-gutters")) continue;
			const color = getComputedStyle(parent).color;
			for (const char of node.textContent ?? "") {
				if (char.trim()) colors.push(`${char} ${color}`);
			}
		}
		return colors;
	});

/// The left edge of the first visible character of the code under `root`.
const codeLeft = (root: Locator) =>
	root.evaluate((element) => {
		const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
		while (walker.nextNode()) {
			const node = walker.currentNode;
			if (node.parentElement?.closest(".cm-gutters")) continue;
			const offset = (node.textContent ?? "").search(/\S/);
			if (offset < 0) continue;
			const range = document.createRange();
			range.setStart(node, offset);
			range.setEnd(node, offset + 1);
			return range.getBoundingClientRect().left;
		}
		return null;
	});

for (const [language, content] of Object.entries(SOURCES)) {
	test(`a ${language} resource opens in the editor with the colors and place of its view`, async ({
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
				slug: "snippet",
				title: "snippet",
				data: { type: "CODE", language, content },
			},
			FULL_ACCESS,
		);
		await logInAs(page, student);
		const href = courseHref({
			discipline: course.discipline.slug,
			instructor: course.instructor.username,
			edition: course.edition.slug,
		});

		await page.goto(`${href}/resources/snippet`);
		const view = page.locator("[data-editor-static]");
		const viewColors = await charColors(view);
		const viewLeft = await codeLeft(view);
		await view.focus();

		const lines = page.locator(".cm-editor .cm-line");
		await expect(lines.first()).toContainText(/greeting|module/);
		const editor = page.locator(".cm-editor .cm-content");
		const editorColors = await charColors(editor);
		expect(
			new Set(editorColors.map((entry) => entry.split(" ")[1])).size,
		).toBeGreaterThan(1);
		expect(editorColors).toEqual(viewColors);
		expect(await codeLeft(editor)).toBeCloseTo(viewLeft ?? Number.NaN, 0);
	});
}
