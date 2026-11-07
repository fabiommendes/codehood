import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { draftKey } from "@/components/exam/code-draft";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// The code answer of an exam: the editor in place of the textarea, autosave
// status, the local draft and its conflict with the saved answer.

test.beforeEach(resetDatabase);

const ANSWER_ACTION = "**/_actions/exam.answer**";
const SECOND = 1000;

interface Setup {
	page: Page;
	type?: "PRACTICE" | "QUIZ" | "EXAM";
	allowCodeRun?: boolean | null;
	duration?: { minutes: number };
	highlight?: string;
	stem?: string;
	epilogue?: string;
	/// An extra `content: "text"` essay with the same stem and epilogue, first in the exam.
	textTwin?: boolean;
}

/// A student in an open attempt at an exam whose question is a code essay.
async function setup(options: Setup) {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const stem = options.stem ?? "Print the sum of 1 and 2.";
	const common = {
		stem,
		epilogue: options.epilogue,
		tags: [],
	};
	const questions = [{ slug: "code" }];
	await db.question.create(
		{
			status: "PUBLISHED",
			version: "1",
			course: course.id,
			slug: "code",
			question: {
				type: "essay",
				content: "code",
				highlight: options.highlight ?? "javascript",
				...common,
			},
		},
		FULL_ACCESS,
	);
	if (options.textTwin) {
		await db.question.create(
			{
				status: "PUBLISHED",
				version: "1",
				course: course.id,
				slug: "twin",
				question: { type: "essay", content: "text", ...common },
			},
			FULL_ACCESS,
		);
		questions.unshift({ slug: "twin" });
	}
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "code-exam",
		type: options.type ?? "PRACTICE",
		status: "ONGOING",
		allowCodeRun: options.allowCodeRun,
		duration: options.duration,
		questions,
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
	await logInAs(options.page, student);
	return {
		student,
		course,
		exam,
		attempt,
		url: `${href}/exams/${exam.slug}`,
		/// The draft key as the page builds it.
		draftKey: (question = "code", exam = "code-exam") =>
			draftKey({
				username: student.username,
				course: href.replace(/^\//, ""),
				exam,
				question,
			}),
	};
}

type Prepared = Awaited<ReturnType<typeof setup>>;

/// The code the server holds for the question, or null when there is none.
async function savedCode(s: Prepared): Promise<string | null> {
	const [attempt] = await db.response.findMany(
		{ course: s.course.id, exam: s.exam.slug, author: s.student.username },
		FULL_ACCESS,
	);
	const payload = attempt?.submissions
		.filter((submission) => submission.question === "code")
		.at(-1)?.payload;
	return typeof payload === "string" ? payload : null;
}

/// Saves `code` as the student's answer, as the server saw it `ageMs` ago.
async function saveAnswer(s: Prepared, code: string, ageMs: number) {
	await db.response.submit(
		{
			course: s.course.id,
			exam: s.exam.slug,
			question: "code",
			author: s.student.username,
			payload: code,
		},
		FULL_ACCESS,
	);
	await prisma.submission.updateMany({
		where: { response: { id: s.attempt.id } },
		data: { createdAt: new Date(Date.now() - ageMs) },
	});
}

const runner = (page: Page) => page.locator("[data-code-runner]");
const editor = (page: Page) => runner(page).locator(".cm-content");
const footer = (page: Page) => page.locator("[data-code-footer]");

/// Puts a draft in `localStorage`, written `ageMs` ago, before the page opens.
async function seedDraft(page: Page, key: string, code: string, ageMs = 0) {
	await page.goto("/login");
	await page.evaluate(
		([k, c, age]) =>
			localStorage.setItem(
				k as string,
				JSON.stringify({ code: c, savedAt: Date.now() - (age as number) }),
			),
		[key, code, ageMs],
	);
}

test("a JavaScript code answer in a practice exam has an editor and runs", async ({
	page,
}) => {
	const s = await setup({ page });
	await page.goto(s.url);

	await expect(page.locator("#question-1 textarea")).toHaveCount(0);
	await expect(editor(page)).toBeVisible();
	await editor(page).fill('console.log("hello from the exam")');

	let answers = 0;
	await expect.poll(() => savedCode(s)).toContain("hello from the exam");
	await page.route(ANSWER_ACTION, (route) => {
		answers++;
		return route.continue();
	});
	await runner(page).locator("[data-action=run]").click();
	await expect(
		runner(page).locator("[data-terminal] .xterm-accessibility-tree"),
	).toContainText("hello from the exam");

	expect(answers).toBe(0);
	await expect(page.locator("[data-code-badge]")).toBeVisible();
});

test("the code of the editor is the answer that was sent", async ({ page }) => {
	const s = await setup({ page });
	await page.goto(s.url);

	await editor(page).fill("let total = 1 + 2;\nconsole.log(total);");
	await expect
		.poll(() => savedCode(s))
		.toBe("let total = 1 + 2;\nconsole.log(total);");
});

test("when the teacher turned running off the answer is still written and saved", async ({
	page,
}) => {
	const s = await setup({ page, type: "QUIZ" });
	await page.goto(s.url);

	await expect(
		page.getByText("The professor disabled code execution in this exam."),
	).toBeVisible();
	await expect(runner(page).locator("[data-action=run]")).toBeDisabled();
	await expect(page.locator("[data-code-badge]")).toHaveCount(0);

	await editor(page).fill("console.log(3)");
	await expect.poll(() => savedCode(s)).toBe("console.log(3)");
	await expect(footer(page)).toContainText(/Saved at \d\d:\d\d/);
});

test("an exam that turns running on explicitly runs code", async ({ page }) => {
	const s = await setup({ page, type: "EXAM", allowCodeRun: true });
	await page.goto(s.url);

	await expect(runner(page).locator("[data-action=run]")).toBeEnabled();
	await expect(page.locator("[data-code-badge]")).toBeVisible();
});

test("an exam that is not running code reserves no runtime", async ({
	page,
}) => {
	const s = await setup({ page, type: "QUIZ" });
	await page.goto(s.url);

	await editor(page).fill("console.log(3)");
	await expect.poll(() => savedCode(s)).toBe("console.log(3)");
	await expect(page.locator("iframe[data-runner-frame]")).toHaveCount(0);
});

test("when the server does not receive the save, the footer says since when and the draft stays", async ({
	page,
}) => {
	const s = await setup({ page });
	await page.goto(s.url);
	await page.route(ANSWER_ACTION, (route) => route.abort());

	await editor(page).fill("console.log('kept')");

	await expect(footer(page)).toContainText(
		/The server has not received your changes since \d\d:\d\d\. The draft stays in this browser\./,
	);
	const stored = await page.evaluate(
		(key) => localStorage.getItem(key),
		s.draftKey(),
	);
	expect(JSON.parse(stored ?? "null").code).toBe("console.log('kept')");
	expect(await savedCode(s)).toBeNull();
});

test("a draft the server confirms is removed from the browser", async ({
	page,
}) => {
	const s = await setup({ page });
	await page.goto(s.url);

	await editor(page).fill("console.log('saved')");
	await expect.poll(() => savedCode(s)).toBe("console.log('saved')");
	await expect(footer(page)).toContainText(/Saved at/);
	await expect
		.poll(() => page.evaluate((key) => localStorage.getItem(key), s.draftKey()))
		.toBeNull();
});

test("the save answers with the server's clock, so the page can measure its offset", async ({
	page,
}) => {
	const s = await setup({ page });
	const response = await page.request.post("/_actions/exam.answer", {
		data: {
			discipline: s.course.discipline.slug,
			course: `${s.course.instructor.username}_${s.course.edition.slug}`,
			exam: s.exam.slug,
			question: "code",
			payload: "console.log(1)",
		},
	});
	const body = await response.text();
	expect(response.ok(), body).toBe(true);
	const stamp = Number(body.match(/\d{13}/)?.[0]);
	expect(Math.abs(stamp - Date.now())).toBeLessThan(10 * SECOND);
});

test("a different draft shows both versions, with Run off, and keeping the draft saves it", async ({
	page,
}) => {
	const s = await setup({ page });
	await saveAnswer(s, "console.log('server')", 60 * SECOND);
	await seedDraft(page, s.draftKey(), "console.log('draft')");
	await page.goto(s.url);

	const panel = page.locator("[data-code-conflict]");
	await expect(panel).toBeVisible();
	await expect(panel).toContainText("Two versions of this answer");
	await expect(panel.locator("[data-conflict-side=draft] pre")).toHaveText(
		"console.log('draft')",
	);
	await expect(panel.locator("[data-conflict-side=server] pre")).toHaveText(
		"console.log('server')",
	);
	await expect(panel.locator("[data-conflict-side=draft]")).toContainText(
		/edited at \d\d:\d\d/,
	);
	await expect(panel.locator("[data-conflict-side=server]")).toContainText(
		/saved at \d\d:\d\d/,
	);
	await expect(panel.locator("[data-action=run]")).toBeDisabled();
	await expect(editor(page)).toHaveCount(0);

	await panel
		.getByRole("button", { name: "Keep this browser's draft" })
		.click();

	await expect(panel).toHaveCount(0);
	await expect(editor(page)).toContainText("console.log('draft')");
	await expect.poll(() => savedCode(s)).toBe("console.log('draft')");
});

test("choosing the server's version drops the draft and leaves the answer alone", async ({
	page,
}) => {
	const s = await setup({ page });
	await saveAnswer(s, "console.log('server')", 60 * SECOND);
	await seedDraft(page, s.draftKey(), "console.log('draft')");
	await page.goto(s.url);

	await page.getByRole("button", { name: "Use the server's version" }).click();

	await expect(page.locator("[data-code-conflict]")).toHaveCount(0);
	await expect(editor(page)).toContainText("console.log('server')");
	expect(
		await page.evaluate((key) => localStorage.getItem(key), s.draftKey()),
	).toBeNull();
	expect(await savedCode(s)).toBe("console.log('server')");
});

test("a draft equal to the saved answer opens no conflict and is dropped", async ({
	page,
}) => {
	const s = await setup({ page });
	await saveAnswer(s, "console.log('same')", 60 * SECOND);
	await seedDraft(page, s.draftKey(), "console.log('same')");
	await page.goto(s.url);

	await expect(editor(page)).toContainText("console.log('same')");
	await expect(page.locator("[data-code-conflict]")).toHaveCount(0);
	expect(
		await page.evaluate((key) => localStorage.getItem(key), s.draftKey()),
	).toBeNull();
});

test("the submit dialog lists the question whose versions disagree", async ({
	page,
}) => {
	const s = await setup({ page });
	await saveAnswer(s, "console.log('server')", 60 * SECOND);
	await seedDraft(page, s.draftKey(), "console.log('draft')");
	await page.goto(s.url);
	await expect(page.locator("[data-code-conflict]")).toBeVisible();

	await page
		.getByRole("button", { name: /^Submit/ })
		.first()
		.click();

	await expect(page.getByRole("dialog")).toContainText(
		"Two versions of the answer in Q1.",
	);
});

test("when time runs out a newer draft is saved and a newer server version is kept", async ({
	page,
}) => {
	const s = await setup({ page, duration: { minutes: 1 } });
	await saveAnswer(s, "console.log('server')", 120 * SECOND);
	await prisma.response.update({
		where: { id: s.attempt.id },
		data: { createdAt: new Date(Date.now() - 45 * SECOND) },
	});
	await seedDraft(page, s.draftKey(), "console.log('draft')");
	await page.goto(s.url);
	await expect(page.locator("[data-code-conflict]")).toBeVisible();

	await expect
		.poll(() => savedCode(s), { timeout: 20 * SECOND })
		.toBe("console.log('draft')");
	await expect(page.getByText("Submitted").first()).toBeVisible({
		timeout: 20 * SECOND,
	});
});

test("submitting removes this exam's drafts and no others", async ({
	page,
}) => {
	const s = await setup({ page, type: "EXAM" });
	await seedDraft(page, s.draftKey("ghost"), "x");
	await page.evaluate(
		(key) =>
			localStorage.setItem(
				key,
				JSON.stringify({ code: "y", savedAt: Date.now() }),
			),
		s.draftKey("code", "another-exam"),
	);
	await page.goto(s.url);
	await editor(page).fill("console.log(1)");
	await expect.poll(() => savedCode(s)).toBe("console.log(1)");

	await page
		.getByRole("button", { name: /^Submit/ })
		.first()
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /submit|confirm/i })
		.click();
	await expect(page.getByText("Submitted").first()).toBeVisible();

	const keys = await page.evaluate(() =>
		Object.keys(localStorage).filter((key) =>
			key.startsWith("codehood:code-draft:"),
		),
	);
	expect(keys).toEqual([s.draftKey("code", "another-exam")]);
});

test("a code question in a language without a driver keeps the textarea", async ({
	page,
}) => {
	const s = await setup({ page, highlight: "haskell" });
	await page.goto(s.url);

	await expect(page.locator("#question-1 textarea")).toBeVisible();
	await expect(runner(page)).toHaveCount(0);
});

test("stem and epilogue have the same DOM as the essay question of mdq", async ({
	page,
}) => {
	const s = await setup({
		page,
		textTwin: true,
		stem: "See [the docs](https://example.com/docs) and `inline`:\n\n```js\nlet a = 1 < 2;\n```\n\n<script>window.hacked = 1</script> and <b>bold</b> & more",
		epilogue: 'Done with **care**.\n\n<img src=x onerror="window.hacked = 1">',
	});
	await page.goto(s.url);
	await expect(editor(page)).toBeVisible();

	// Hydration keys differ between any two elements; the markup must not.
	const html = async (question: number, part: "stem" | "epilogue") =>
		(
			await page.locator(`#question-${question} .mdq-${part}`).innerHTML()
		).replace(/ data-hk="[^"]*"/g, "");
	const twinStem = await html(1, "stem");
	const twinEpilogue = await html(1, "epilogue");
	expect(twinStem).toContain('href="https://example.com/docs"');
	expect(await html(2, "stem")).toBe(twinStem);
	expect(await html(2, "epilogue")).toBe(twinEpilogue);
	expect(await page.evaluate(() => "hacked" in window)).toBe(false);
	await expect(page.locator("#question-2 .mdq-stem script")).toHaveCount(0);
});

test("the exam page says where the code-run setting comes from", async ({
	page,
}) => {
	const practice = await setup({ page });
	await page.goto(practice.url);
	await expect(page.getByTestId("code-run-setting")).toHaveText(
		"Code execution: on (PRACTICE default)",
	);
});

test("an exam that switches running off in the exam says so", async ({
	page,
}) => {
	const s = await setup({ page, type: "PRACTICE", allowCodeRun: false });
	await page.goto(s.url);
	await expect(page.getByTestId("code-run-setting")).toHaveText(
		"Code execution: off (set in the exam)",
	);
	await expect(runner(page).locator("[data-action=run]")).toBeDisabled();
});
