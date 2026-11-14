import { parseQuestion } from "mdq";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The pretest of an Elm question whose tests are an examples block: an
// `{example}` region, a `{public}` scored one and a private one. The browser
// gets a module with the public cases only, named after the case text.

test.beforeEach(resetDatabase);

const QUESTION = `---
id: elm-examples
title: Media de notas por exemplos
type: code
language: elm
file: Main.elm
meta:
  worker: elm-test
---

Complete \`media\`.

[code]

## [template]

\`\`\`elm
module Main exposing (..)


media : List Int -> Int
media notas =
    0
\`\`\`

## [tests]

\`\`\`elm
-- mdq: [0] {example} Exemplos
media [ 6, 8 ] ==> 7 -- dois valores

-- mdq: [1] {public} Lista vazia
media [] ==> 0

-- mdq: [1] Segredo
media [ 9 ] ==> 424242
\`\`\`
`;

/// Declarations only: the browser run adds the `module Main` header.
const CORRECT = `media : List Int -> Int
media notas =
    if List.isEmpty notas then
        0

    else
        List.sum notas // List.length notas
`;
/// Passes the example and fails the empty list.
const WRONG = CORRECT.replace("then\n        0", "then\n        5");

/// The question with its examples block as the only test source.
function elmQuestion() {
	const parsed = parseQuestion(QUESTION);
	if (parsed.type !== "code") throw new Error("not a code question");
	return parsed;
}

async function setup(page: Page) {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "media",
			question: elmQuestion(),
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "elm-exam",
		type: "PRACTICE",
		status: "ONGOING",
		allowCodeRun: false,
		questions: [{ slug: "media" }],
	});
	await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await logInAs(page, student);
	return `${href}/exams/${exam.slug}`;
}

async function write(page: Page, code: string) {
	await page.locator("[data-code-editor] .cm-content").click();
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.insertText(code);
}

const result = (page: Page) =>
	page.locator("[data-pretest-result] [data-status]");

test("an examples block runs its public cases, with the inline comment in the name", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.goto(await setup(page));
	await expect(page.locator("[data-code-editor] .cm-content")).toBeVisible();
	const button = page.locator("[data-action=run-pretests]");
	await expect(button).toBeEnabled();

	await write(page, CORRECT);
	await button.click();
	await expect(result(page)).toHaveAttribute("data-status", "passed", {
		timeout: 120_000,
	});
	await expect(page.locator("[data-verdict=pass]")).toHaveCount(2);

	await write(page, WRONG);
	await button.click();
	await expect(result(page)).toHaveAttribute("data-status", "failed", {
		timeout: 120_000,
	});
	await expect(page.locator("[data-verdict=pass]")).toHaveCount(1);
	await expect(page.locator("[data-verdict=pass]")).toContainText(
		"media [ 6, 8 ] ==> 7 (dois valores)",
	);
	await expect(page.locator("[data-verdict=fail]")).toHaveCount(1);
	await expect(page.locator("[data-verdict=fail]")).toContainText(
		"media [] ==> 0",
	);

	// The private case, whose name holds the expected value, never reaches the page.
	const html = await page.content();
	expect(html).not.toContain("424242");
	expect(html).not.toContain("Segredo");
});
