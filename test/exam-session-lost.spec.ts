import { randomBytes } from "node:crypto";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "./fixtures";
import { logIn, logInAs, seedUser } from "./stories/helpers";

// A session lost in the middle of an exam: the page says so, keeps the typed
// text, and sends it once the student logs in again. These specs create their
// own users and course and never reset the database.

const SECOND = 1000;

/// A student in an open attempt at an untimed exam with a text essay, `text`.
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
			slug: "text",
			question: {
				type: "essay",
				content: "text",
				stem: "Say something.",
				tags: [],
			},
		},
		FULL_ACCESS,
	);
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: `session-lost-${randomBytes(4).toString("hex")}`,
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "text" }],
	});
	await db.response.create(
		{ course: course.id, exam: exam.slug, author: student.username },
		FULL_ACCESS,
	);
	await db.response.submit(
		{
			course: course.id,
			exam: exam.slug,
			question: "text",
			author: student.username,
			payload: "old answer",
		},
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await logInAs(page, student);
	return { student, course, exam, url: `${href}/exams/${exam.slug}` };
}

type Prepared = Awaited<ReturnType<typeof setup>>;

/// The latest payload the server holds for the text question, or null.
async function saved(s: Prepared): Promise<unknown> {
	const [attempt] = await db.response.findMany(
		{ course: s.course.id, exam: s.exam.slug, author: s.student.username },
		FULL_ACCESS,
	);
	return (
		attempt?.submissions.filter((it) => it.question === "text").at(-1)
			?.payload ?? null
	);
}

/// Ends the student's sessions in the database, as a logout elsewhere would.
async function loseSession(s: Prepared): Promise<void> {
	await prisma.session.deleteMany({ where: { username: s.student.username } });
}

const answerBox = (page: Page) => page.getByRole("textbox").first();

/// Opens the exam, loses the session and types `text`, which the server refuses.
async function typeWithoutSession(page: Page, s: Prepared, text: string) {
	await page.goto(s.url);
	await expect(answerBox(page)).toHaveValue("old answer");
	await loseSession(s);
	await answerBox(page).fill(text);
	await answerBox(page).blur();
}

const sessionAlert = (page: Page) =>
	page.getByRole("alert").filter({ hasText: /session/i });

test("a lost session shows a notice with a login link, and keeps the text", async ({
	page,
}) => {
	const s = await setup(page);
	await typeWithoutSession(page, s, "typed without a session");

	const notice = sessionAlert(page).first();
	await expect(notice).toBeVisible();
	const link = notice.getByRole("link");
	await expect(link).toHaveAttribute("target", "_blank");
	await expect(link).toHaveAttribute("rel", /noopener/);
	const href = new URL((await link.getAttribute("href")) ?? "", page.url());
	expect(href.pathname).toBe("/login");
	expect(href.searchParams.get("next")).toBe(s.url);

	await expect(answerBox(page)).toHaveValue("typed without a session");
	expect(await saved(s)).toBe("old answer");
});

test("logging in again in another tab clears the notice and sends the text", async ({
	page,
	context,
}) => {
	const s = await setup(page);
	await typeWithoutSession(page, s, "sent after the new login");
	await expect(sessionAlert(page).first()).toBeVisible();

	const other = await context.newPage();
	await logIn(other, s.student);
	await page.bringToFront();

	await expect
		.poll(() => saved(s), { timeout: 45 * SECOND })
		.toBe("sent after the new login");
	await expect(sessionAlert(page)).toHaveCount(0);
	await expect(answerBox(page)).toHaveValue("sent after the new login");
});

test("a finish refused for the session says so, and loses nothing", async ({
	page,
}) => {
	const s = await setup(page);
	await page.goto(s.url);
	await expect(answerBox(page)).toHaveValue("old answer");
	await page.evaluate(() => {
		(window as unknown as { marker: number }).marker = 1;
	});
	await answerBox(page).fill("typed, then the session ended");
	await loseSession(s);

	await page
		.getByRole("button", { name: /^Submit/ })
		.first()
		.click();
	await page
		.getByRole("dialog")
		.getByRole("button", { name: /submit|confirm/i })
		.click();

	await expect(sessionAlert(page).first()).toBeVisible();
	await expect(
		page.getByRole("alert").filter({ hasText: /fix the errors/i }),
	).toHaveCount(0);
	await expect(answerBox(page)).toHaveValue("typed, then the session ended");
	expect(
		await page.evaluate(() => (window as never as { marker?: number }).marker),
	).toBe(1);
	expect(await saved(s)).toBe("old answer");
	const [attempt] = await db.response.findMany(
		{ course: s.course.id, exam: s.exam.slug, author: s.student.username },
		FULL_ACCESS,
	);
	expect(attempt?.acceptingSubmissions).toBe(true);
});

test("reloading while logged out leads back to the exam after login, and the draft is sent", async ({
	page,
}) => {
	const s = await setup(page);
	await typeWithoutSession(page, s, "draft kept across the login");
	await expect(sessionAlert(page).first()).toBeVisible();

	await page.reload();
	await expect(page).toHaveURL(/\/login\?next=/);
	expect(new URL(page.url()).searchParams.get("next")).toBe(s.url);

	await page.locator("input[name=login]").fill(s.student.username);
	await page.locator("input[name=password]").fill(s.student.password);
	await page.getByRole("button", { name: "Log in" }).click();

	await expect(page).toHaveURL(s.url);
	await expect
		.poll(() => saved(s), { timeout: 20 * SECOND })
		.toBe("draft kept across the login");
	await expect(answerBox(page)).toHaveValue("draft kept across the login");
});

test("a save error with no message still shows a text for the question", async ({
	page,
}) => {
	const s = await setup(page);
	await page.goto(s.url);
	await expect(answerBox(page)).toHaveValue("old answer");
	await page.route("**/_actions/exam.answer**", (route) =>
		route.fulfill({
			status: 500,
			contentType: "application/json",
			body: JSON.stringify({
				type: "AstroActionError",
				code: "INTERNAL_SERVER_ERROR",
				message: "",
			}),
		}),
	);
	await answerBox(page).fill("refused");
	await answerBox(page).blur();

	await expect(
		page
			.getByRole("alert")
			.filter({ hasText: /could not save/i })
			.first(),
	).toBeVisible();
	for (const alert of await page.getByRole("alert").all()) {
		expect((await alert.innerText()).trim()).not.toBe("");
	}
});

test("a logged-out visit to a course page redirects to login with the path and query as next", async ({
	page,
	context,
}) => {
	const s = await setup(page);
	await context.clearCookies();

	await page.goto(`${s.url}?tab=1`);

	await expect(page).toHaveURL(/\/login\?next=/);
	expect(new URL(page.url()).searchParams.get("next")).toBe(`${s.url}?tab=1`);
});
