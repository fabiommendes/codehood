import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// Code answers on the grading pages: highlighted, runnable when the language
// has a driver, and never touching a grade.

test.beforeEach(resetDatabase);

type Student = Awaited<ReturnType<typeof seedUser>>;

interface Sitting {
	href: string;
	students: Student[];
	/// Public ids of the submissions to the code question, in student order.
	submissions: string[];
}

/**
 * A closed exam with a code essay (`highlight`), a text essay and a code
 * essay in Haskell, which no driver runs. Each of `codes` is answered by one
 * student, who also answers the other two questions. Logs in the instructor.
 */
async function closedSitting(
	page: Page,
	codes: string[],
	highlight = "javascript",
): Promise<Sitting> {
	const teacher = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const essay = (slug: string, extra: Record<string, string>) =>
		db.question.create(
			{
				status: "PUBLISHED",
				version: "1",
				course: course.id,
				slug,
				question: { type: "essay", stem: `Question ${slug}`, ...extra },
			},
			FULL_ACCESS,
		);
	await essay("code", { content: "code", highlight });
	await essay("prose", { content: "text" });
	await essay("hs", { content: "code", highlight: "haskell" });
	const exam = await persistedExamFactory.create({
		course: course.id,
		slug: "midterm",
		title: "Midterm exam",
		type: "EXAM",
		status: "ONGOING",
		questions: [{ slug: "code" }, { slug: "prose" }, { slug: "hs" }],
	});
	const students: Student[] = [];
	const submissions: string[] = [];
	for (const [i, code] of codes.entries()) {
		const student = await seedUser({
			role: "STUDENT",
			username: `code-student-${i + 1}`,
		});
		await db.enrollment.create(
			{ course: course.id, username: student.username },
			FULL_ACCESS,
		);
		students.push(student);
		const answers: Record<string, string> = {
			code,
			prose: `Prose of ${student.username}`,
			hs: "main = putStrLn (show 3)",
		};
		for (const [question, payload] of Object.entries(answers)) {
			const response = await db.response.submit(
				{ course: course.id, exam: exam.slug, question, payload },
				{ actor: student },
			);
			if (question === "code") {
				submissions.push(response.submissions.at(-1)?.publicId ?? "");
			}
		}
		await db.response.finish(
			{ course: course.id, exam: exam.slug },
			{ actor: student },
		);
	}
	await prisma.exam.update({
		where: { id: exam.id },
		data: { status: "COMPLETED" },
	});
	await logInAs(page, teacher);
	return {
		href: `${courseHref({
			discipline: course.discipline.slug,
			instructor: course.instructor.username,
			edition: course.edition.slug,
		})}/exams/${exam.slug}`,
		students,
		submissions,
	};
}

const frames = (page: Page) => page.locator("iframe[data-runner-frame]");

test("a code answer is highlighted on the question page, with Run", async ({
	page,
}) => {
	const sitting = await closedSitting(page, ['console.log("hello");']);
	await page.goto(`${sitting.href}/grading/code`);
	const card = page.locator(`#answer-${sitting.submissions[0]}`);
	const widget = card.locator("[data-code-runner][data-mode=review]");
	await expect(widget).toBeVisible();
	await expect(widget.locator("[data-editor-static] .shiki")).toContainText(
		'console.log("hello");',
	);
	await expect(widget.locator("[data-action=run]")).toContainText(
		"Run submission",
	);
	await expect(widget.locator("[data-action=edit]")).toBeVisible();
});

test("the attempt page shows the code answer highlighted and runnable", async ({
	page,
}) => {
	const sitting = await closedSitting(page, ['console.log("hello");']);
	const [student] = sitting.students;
	await page.goto(`${sitting.href}/attempts/${student?.username}`);
	const widget = page.locator("[data-code-runner][data-mode=review]");
	await expect(widget).toHaveCount(1);
	await expect(widget.locator(".shiki")).toContainText('console.log("hello");');
	await widget.locator("[data-action=run]").click();
	await expect(widget.locator("[data-terminal]")).toContainText("hello");
});

test("a language without a driver is highlighted with no Run", async ({
	page,
}) => {
	const sitting = await closedSitting(page, ["1"]);
	await page.goto(`${sitting.href}/grading/hs?view=list`);
	const card = page.locator("article").first();
	await expect(card.locator("[data-answer-code] .shiki")).toContainText(
		"putStrLn",
	);
	await expect(page.locator("[data-code-runner]")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Run submission" }),
	).toHaveCount(0);
});

test("a text essay is still plain text", async ({ page }) => {
	const sitting = await closedSitting(page, ["1"]);
	await page.goto(`${sitting.href}/grading/prose?view=list`);
	const card = page.locator("article").first();
	await expect(card.locator("p.whitespace-pre-wrap")).toHaveText(
		"Prose of code-student-1",
	);
	await expect(page.locator("[data-code-runner]")).toHaveCount(0);
	await expect(page.locator("[data-answer-code]")).toHaveCount(0);
});

test("a page with many answers creates no iframe and loads no editor until a click", async ({
	page,
}) => {
	const sitting = await closedSitting(
		page,
		Array.from({ length: 12 }, (_, i) => `console.log(${i});`),
	);
	await page.goto(`${sitting.href}/grading/code`);
	await expect(page.locator("[data-code-runner]")).toHaveCount(12);
	await page.waitForLoadState("networkidle");
	await expect(frames(page)).toHaveCount(0);
	await expect(page.locator(".cm-editor")).toHaveCount(0);
	await expect(page.locator(".xterm")).toHaveCount(0);
	const first = page.locator("[data-code-runner]").first();
	await first.scrollIntoViewIfNeeded();
	// Hydration starts when the widget scrolls into view.
	await expect(
		first.locator("xpath=ancestor::astro-island"),
	).not.toHaveAttribute("ssr", "", { timeout: 15_000 });
	await first.locator("[data-action=run]").click();
	await expect(frames(page)).toHaveCount(1);
	await expect(first.locator("[data-terminal]")).toContainText("0");
});

test("running and editing a code answer changes no grade or comment", async ({
	page,
}) => {
	const sitting = await closedSitting(page, ['console.log("hello");']);
	const submission = sitting.submissions[0];
	const passes = () =>
		prisma.feedback.count({ where: { submission: { publicId: submission } } });
	const before = await passes();
	// The list view keeps each answer's comment field inside its card.
	await page.goto(`${sitting.href}/grading/code?view=list`);
	const widget = page.locator(`#answer-${submission} [data-code-runner]`);
	await widget.locator("[data-action=run]").click();
	await expect(widget.locator("[data-terminal]")).toContainText("hello");
	await widget.locator("[data-action=edit]").click();
	await widget.locator(".cm-content").fill('console.log("edited");');
	await widget.locator("[data-action=run]").click();
	await expect(widget.locator("[data-terminal]")).toContainText("edited");
	await widget.locator("[data-action=back]").click();
	expect(await passes()).toBe(before);
	await expect(
		page
			.locator(`#answer-${submission}`)
			.getByLabel("Comment", { exact: true }),
	).toHaveValue("");
});
