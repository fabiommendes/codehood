import { parseQuestion, resolveTests } from "mdq";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The pretest of an Elm question whose public tests are a linked module in the
// style of the teste2-elm course: `import Main as S`, an `{example}` annotation
// and a private source that the browser never runs.

test.beforeEach(resetDatabase);

const QUESTION = `---
id: elm-media
title: Media de notas
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

[Public](MediaPublic.elm)

[Private](MediaPrivate.elm)
`;

const PUBLIC = `module MediaPublic exposing (tests)

import Expect
import Main as S
import Test exposing (Test, describe, test)



-- mdq: [0] {example} Exemplos de media


tests : Test
tests =
    describe "Exemplos"
        [ test "dois valores" <| \\_ -> Expect.equal 7 (S.media [ 6, 8 ])
        , test "lista vazia" <| \\_ -> Expect.equal 0 (S.media [])
        ]
`;

const PRIVATE = `module MediaPrivate exposing (tests)

import Expect
import Main as S
import Test exposing (Test, test)



-- mdq: [1] Segredo


tests : Test
tests =
    test "caso-privado-secreto" <| \\_ -> Expect.equal 9 (S.media [ 9 ])
`;

/// Declarations only: the browser run adds the `module Main` header.
const CORRECT = `media : List Int -> Int
media notas =
    if List.isEmpty notas then
        0

    else
        List.sum notas // List.length notas
`;
const WRONG = CORRECT.replace("List.sum notas //", "1 +");

/// The question with its test sources resolved.
function elmQuestion() {
	const parsed = parseQuestion(QUESTION);
	if (parsed.type !== "code") throw new Error("not a code question");
	return resolveTests(parsed, {
		"MediaPublic.elm": PUBLIC,
		"MediaPrivate.elm": PRIVATE,
	});
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

test("a module with `import Main as S` runs, and an answer with no header gets one", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.goto(await setup(page));
	await expect(page.locator("[data-code-editor] .cm-content")).toBeVisible();
	const button = page.locator("[data-action=run-pretests]");
	await expect(button).toBeEnabled();
	await expect(page.locator("[data-pretest-hint=on]")).toBeVisible();

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
	await expect(page.locator("[data-verdict=fail]").first()).toBeVisible();
	await expect(page.locator("[data-verdict=pass]").first()).toBeVisible();

	// The private source stays out of the page and out of the run.
	expect(await page.content()).not.toContain("caso-privado-secreto");
});
