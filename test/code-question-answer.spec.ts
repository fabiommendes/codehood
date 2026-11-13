import { readFileSync } from "node:fs";
import path from "node:path";
import { parseQuestion, resolveTests } from "mdq";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// A student answers an MDQ `code` question: the editor starts on the template,
// the pretests run in the real browser runner, the answer is autosaved, and the
// page never carries what the public form hides.

test.beforeEach(resetDatabase);

const EXAMPLE_DIR = path.join(
	process.cwd(),
	"workers/chalk-worker/example/questions/elm",
);

/// The Elm example question, with its test sources read from disk.
function elmQuestion(meta?: { worker: string | null; attempts: number }) {
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
	return resolveTests(meta ? { ...parsed, meta } : parsed, texts);
}

const CORRECT = [
	"module Main exposing (soma)",
	"",
	"soma : List Int -> Int",
	"soma xs =",
	"    List.foldl (+) 0 xs",
	"",
].join("\n");
const WRONG = CORRECT.replace("List.foldl (+) 0 xs", "1");

/// A student in an open attempt at an exam with the Elm code question.
async function setup(
	page: Page,
	options: {
		type?: "PRACTICE" | "QUIZ";
		meta?: { worker: string | null; attempts: number };
	} = {},
) {
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
			slug: "soma",
			question: elmQuestion(options.meta),
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "code-exam",
		type: options.type ?? "PRACTICE",
		status: "ONGOING",
		allowCodeRun: false,
		questions: [{ slug: "soma" }],
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

/// Replaces the editor's content with `code`.
async function write(page: Page, code: string) {
	const content = page.locator("[data-code-editor] .cm-content");
	await content.click();
	await page.keyboard.press("ControlOrMeta+A");
	await page.keyboard.insertText(code);
}

const submitButton = (page: Page) => page.locator("[data-action=submit]");
const submitStatus = (page: Page) => page.locator("[data-submit-status]");

const result = (page: Page) =>
	page.locator("[data-pretest-result] [data-status]");

test("the editor starts on the template and the page hides the tests", async ({
	page,
}) => {
	const url = await setup(page);
	await page.goto(url);
	const content = page.locator("[data-code-editor] .cm-content");
	await expect(content).toContainText("soma xs =");
	await expect(content).toContainText("0");
	await expect(page.locator("[data-action=run-pretests]")).toBeEnabled();

	const html = await page.content();
	for (const secret of ["Soma listas longas", "Expect.equal 55", "List.sum"]) {
		expect(html, secret).not.toContain(secret);
	}
	const source = await (await page.request.get(url)).text();
	for (const secret of ["Soma listas longas", "Expect.equal 55", "List.sum"]) {
		expect(source, secret).not.toContain(secret);
	}
});

test("pretests pass for a correct answer and fail for a wrong one", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await page.goto(await setup(page));
	await expect(page.locator("[data-code-editor] .cm-content")).toBeVisible();

	await write(page, CORRECT);
	await page.locator("[data-action=run-pretests]").click();
	await expect(result(page)).toHaveAttribute("data-status", "passed", {
		timeout: 120_000,
	});

	await write(page, WRONG);
	await expect(page.locator("[data-stale]")).toBeVisible();
	await page.locator("[data-action=run-pretests]").click();
	await expect(result(page)).toHaveAttribute("data-status", "failed", {
		timeout: 120_000,
	});
	await expect(page.locator("[data-verdict=fail]").first()).toBeVisible();
});

test("the answer is autosaved and survives a reload", async ({ page }) => {
	const url = await setup(page);
	await page.goto(url);
	await expect(page.locator("[data-code-editor] .cm-content")).toBeVisible();
	const saved = page.waitForResponse(
		(response) =>
			response.url().includes("/_actions/exam.answer") && response.ok(),
	);
	await write(page, CORRECT);
	await saved;

	await page.reload();
	await expect(page.locator("[data-code-editor] .cm-content")).toContainText(
		"List.foldl (+) 0 xs",
	);
});

test("a question without a worker has no submit button", async ({ page }) => {
	await page.goto(await setup(page, { meta: { worker: null, attempts: 1 } }));
	await expect(page.locator("[data-action=run-pretests]")).toBeVisible();
	await expect(submitButton(page)).toHaveCount(0);
});

test("a send is accepted and queued for the worker", async ({ page }) => {
	const meta = { worker: "elm-test", attempts: 2 };
	await page.goto(await setup(page, { type: "QUIZ", meta }));
	await expect(submitStatus(page)).toContainText("0 of 2");
	await write(page, CORRECT);
	await submitButton(page).click();
	await expect(submitStatus(page)).toHaveAttribute(
		"data-submit-status",
		"sent",
	);
	await expect(submitStatus(page)).toContainText("waiting to be graded");

	const jobs = await prisma.gradingJob.findMany();
	expect(jobs.map((job) => job.state)).toEqual(["QUEUED"]);
	const row = page.locator("[data-send]");
	await expect(row).toHaveAttribute("data-job-state", "QUEUED");

	// The page asks again while the send waits.
	await prisma.gradingJob.updateMany({ data: { state: "CLAIMED" } });
	await expect(row).toHaveAttribute("data-job-state", "CLAIMED", {
		timeout: 15_000,
	});
});

test("a send is refused with the reason once the attempts are spent", async ({
	page,
}) => {
	const meta = { worker: "elm-test", attempts: 1 };
	await page.goto(await setup(page, { type: "QUIZ", meta }));
	await write(page, CORRECT);
	await submitButton(page).click();
	await expect(submitStatus(page)).toHaveAttribute(
		"data-submit-status",
		"sent",
	);

	// The worker graded it: the one attempt is gone.
	await prisma.gradingJob.updateMany({ data: { state: "DONE" } });
	await write(page, WRONG);
	await submitButton(page).click();
	await expect(submitStatus(page)).toHaveAttribute(
		"data-submit-status",
		"refused",
	);
	await expect(submitStatus(page)).toContainText("no sends left");

	await page.reload();
	await expect(submitStatus(page)).toContainText("1 of 1");
	await expect(submitButton(page)).toBeDisabled();
});
