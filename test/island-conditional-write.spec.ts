import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { createRubricScenario } from "@/fixtures/rubric-scenario";
import { courseHref } from "@/urls";
import { expect, type Page, test } from "./fixtures";
import { logInAs, seedUser } from "./stories/helpers";

/**
 * ADR 0013 on the islands: an edit sends the `updatedAt` the page loaded, a
 * second tab that grabs the same row first makes the first one show the
 * conflict text, and two edits in a row on one page keep working because the
 * island adopts the version the action hands back.
 *
 * Each test builds its own instructor and course.
 */

const STALE_TEXT = "Someone changed this since you opened the page";

async function questionBank() {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const question = await persistedQuestionFactory.create(
		{ course: course.id, status: "DRAFT" },
		{ transient: { type: "essay" } },
	);
	const url = `/${course.discipline.slug}/${course.instructor.username}_${course.edition.slug}/questions`;
	return { instructor, question, url };
}

test("question table: two status changes in a row on one page both go through", async ({
	page,
}) => {
	const { instructor, url } = await questionBank();
	await logInAs(page, instructor);
	await page.goto(url);

	await page.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Hide", exact: true }),
	).toBeVisible();
	await page.getByRole("button", { name: "Hide", exact: true }).click();
	await expect(
		page.getByRole("button", { name: "Publish", exact: true }),
	).toBeVisible();
	await expect(page.getByText(STALE_TEXT)).toHaveCount(0);

	await page.reload();
	await expect(
		page.getByRole("button", { name: "Publish", exact: true }),
	).toBeVisible();
});

test("question table: a second tab that changed the question first makes the stale tab show the conflict", async ({
	browser,
}) => {
	const { instructor, url } = await questionBank();
	const first = await (await browser.newContext()).newPage();
	const second = await (await browser.newContext()).newPage();
	for (const tab of [first, second]) {
		await logInAs(tab, instructor);
		await tab.goto(url);
		await expect(
			tab.getByRole("button", { name: "Publish", exact: true }),
		).toBeVisible();
	}

	await first.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(
		first.getByRole("button", { name: "Hide", exact: true }),
	).toBeVisible();

	await second.getByRole("button", { name: "Publish", exact: true }).click();
	await expect(second.getByText(STALE_TEXT)).toBeVisible();
	// The optimistic change is undone: the row is still the draft the tab loaded.
	await expect(
		second.getByRole("button", { name: "Publish", exact: true }),
	).toBeVisible();

	await second.reload();
	await expect(
		second.getByRole("button", { name: "Hide", exact: true }),
	).toBeVisible();
});

/// A rubric with two loose items and two finished answers of a closed exam, and the URL of the grading view.
async function gradingWorld() {
	const scenario = await createRubricScenario();
	await scenario.seedRubric({
		items: [
			{ key: "naming", text: "Clear naming", value: "0.2" },
			{ key: "off", text: "Off by one", value: "-0.1" },
		],
	});
	const answers = [];
	for (const text of ["First solution", "Second solution"]) {
		const answer = await scenario.addAnswer();
		await prisma.submission.update({
			where: { id: answer.submission.id },
			data: { payload: text },
		});
		await db.response.finish(
			{ course: scenario.course.id, exam: scenario.exam.slug },
			{ actor: answer.author },
		);
		answers.push(answer);
	}
	await scenario.close();
	const course = await prisma.course.findUniqueOrThrow({
		where: { id: scenario.course.id },
	});
	const url = `${courseHref({
		discipline: course.disciplineSlug,
		instructor: course.instructorId,
		edition: course.editionSlug,
	})}/exams/${scenario.exam.slug}/grading/${scenario.main.slug}`;
	return { scenario, answers, url };
}

test("rubric grader: revising a saved answer twice in a row works, a second tab that revised first makes the stale one show the conflict", async ({
	browser,
}) => {
	const { scenario, answers, url } = await gradingWorld();
	const [first] = answers;
	if (!first) throw new Error("no answer");
	const own = `${url}#answer-${first.submission.publicId}`;
	const open = async () => {
		const tab = await (await browser.newContext()).newPage();
		await logInAs(tab, scenario.instructor);
		return tab;
	};
	const panel = (tab: Page) =>
		tab.getByRole("region", { name: "Rubric", exact: true });
	const save = (tab: Page) =>
		tab.getByRole("button", { name: "Save and next" }).click();
	const passes = () =>
		prisma.feedback.findMany({
			where: { submissionId: first.submission.id },
		});

	const a = await open();
	await a.goto(own);
	await panel(a).getByRole("checkbox", { name: "Clear naming" }).check();
	await save(a);
	await expect.poll(async () => (await passes()).length).toBe(1);

	// Back to the saved answer: the revision needs the version the save produced.
	await a.reload();
	await expect(
		panel(a).getByRole("checkbox", { name: "Clear naming" }),
	).toBeChecked();
	await panel(a).getByRole("checkbox", { name: "Off by one" }).check();
	await save(a);
	await expect.poll(async () => (await passes())[0]?.score).toBe("0.1");

	// Same page, no reload: the next revision uses the version the last one returned.
	await a.keyboard.press("j");
	await expect(
		panel(a).getByRole("checkbox", { name: "Off by one" }),
	).toBeChecked();
	await panel(a).getByRole("checkbox", { name: "Off by one" }).uncheck();
	await save(a);
	await expect.poll(async () => (await passes())[0]?.score).toBe("0.2");
	await expect(a.getByText(STALE_TEXT)).toHaveCount(0);

	const b = await open();
	await b.goto(own);
	await expect(
		panel(b).getByRole("checkbox", { name: "Clear naming" }),
	).toBeChecked();
	await a.reload();
	await panel(a).getByRole("checkbox", { name: "Clear naming" }).uncheck();
	await save(a);
	await expect.poll(async () => (await passes())[0]?.score).toBe("0");

	await panel(b).getByRole("checkbox", { name: "Off by one" }).check();
	await save(b);
	await expect(b.getByText(STALE_TEXT)).toBeVisible();
	expect((await passes())[0]?.score).toBe("0");
});

test("rubric editor: two value changes in a row on one page both go through", async ({
	browser,
}) => {
	const { scenario, url } = await gradingWorld();
	const tab = await (await browser.newContext()).newPage();
	await logInAs(tab, scenario.instructor);
	await tab.goto(url);
	await tab.getByRole("button", { name: "Edit rubric" }).click();

	const row = tab
		.getByRole("list", { name: "Rubric items" })
		.getByRole("listitem")
		.filter({ hasText: "Clear naming" });
	const stored = async () =>
		(
			await prisma.rubricItem.findFirstOrThrow({
				where: { key: "naming", rubric: { examId: scenario.exam.id } },
			})
		).value;

	await row.getByRole("textbox", { name: "Value" }).fill("0.3");
	await tab.getByRole("button", { name: "Apply changes" }).click();
	await expect.poll(stored).toBe("0.3");

	await row.getByRole("textbox", { name: "Value" }).fill("0.4");
	await tab.getByRole("button", { name: "Apply changes" }).click();
	await expect.poll(stored).toBe("0.4");
	await expect(tab.getByText(STALE_TEXT)).toHaveCount(0);
});
