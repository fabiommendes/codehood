import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The editor of a CODE resource highlights every language with a driver.

test.beforeEach(resetDatabase);

const SOURCES = {
	lua: 'local greeting = "hi" -- comment\nprint(greeting, 42)\n',
	typescript:
		'const greeting: string = "hi"; // comment\nconsole.log(greeting, 42);\n',
	python: 'def greeting(): return "hi"  # comment\nprint(greeting(), 42)\n',
	prolog: "greeting(X) :- X = 'hi', !. % comment\n:- initialization(main).\n",
} as const;

for (const [language, content] of Object.entries(SOURCES)) {
	test(`a ${language} resource opens in the editor with syntax highlighting`, async ({
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
		await page.locator("[data-editor-static]").focus();

		const lines = page.locator(".cm-editor .cm-line");
		await expect(lines.first()).toContainText("greeting");
		// Tokens get their own spans; unhighlighted text would be a bare text node.
		await expect(lines.first().locator("span").first()).toBeVisible();
		const colors = await lines
			.first()
			.locator("span")
			.evaluateAll((spans) =>
				spans.map((span) => getComputedStyle(span).color),
			);
		expect(new Set(colors).size).toBeGreaterThan(1);
	});
}
