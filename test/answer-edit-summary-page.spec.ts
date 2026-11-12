import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { courseHref } from "@/urls";
import {
	appendBatch,
	makeWorld,
	NORMAL_FIRST_AT,
	NORMAL_LAST_AT,
	receiptOf,
	seedGappedHistory,
	seedNormalHistory,
	sendBatch,
	submitAnswer,
	type World,
} from "./answer-edit-service-support";
import { expect, type Locator, type Page, test } from "./fixtures";
import { logInAs } from "./stories/helpers";

// R35: the block "Histórico de edição" on the instructor's attempt page.
//
// The spec fixes no markup, so these tests assume stable test ids:
//
//   answer-edit-history             the collapsed `<details>` of one answer card
//   answer-edit-history-disclaimer  the fixed line "indícios, não prova de autoria"
//   answer-edit-history-off         the line "Registro desligado nesta prova"
//   answer-edit-history-state       data-state: complete | incomplete | none
//   answer-edit-history-active      data-ms: the active time in milliseconds
//   answer-edit-history-first       data-at: ISO receivedAt of the first batch
//   answer-edit-history-last        data-at: ISO receivedAt of the last batch
//   answer-edit-history-pastes      data-count and data-chars
//   answer-edit-history-large       one per large insertion: data-kind, data-length, data-at
//   answer-edit-history-gap         one per gap: data-type (marker | rebase | final),
//                                   data-reason (marker), data-removed and data-inserted
//                                   (rebase, final), data-at (marker, rebase)
//
// Every test id except the first sits inside the `<details>`. The cards are the
// `article` elements of the page, named "Question N" in the exam's order.

function attemptHref(world: World) {
	const course = courseHref({
		discipline: world.course.discipline.slug,
		instructor: world.course.instructor.username,
		edition: world.course.edition.slug,
	});
	return `${course}/exams/${world.exam.slug}/attempts/${world.student.username}`;
}

function examHref(world: World) {
	return attemptHref(world).replace(/\/attempts\/.*$/, "");
}

function card(page: Page, n: number) {
	return page.getByRole("article", { name: `Question ${n}`, exact: true });
}

/// The block of a card, opened the way a reader opens it.
async function openBlock(block: Locator) {
	await block.locator("summary").first().click();
	await expect(block).toHaveAttribute("open", "");
}

test("the instructor sees the summary of an answer, collapsed, with the values of the history", async ({
	page,
}) => {
	const world = await makeWorld();
	await seedNormalHistory(world);
	await logInAs(page, world.instructor);

	await page.goto(attemptHref(world));

	const block = card(page, 1).getByTestId("answer-edit-history");
	await expect(block).toBeVisible();
	await expect(block).not.toHaveAttribute("open");
	await openBlock(block);
	// Starts 1000, 4000, 4500, 70000, last duration 400: 3000 + 500 + 60000 (limited) + 400.
	await expect(block.getByTestId("answer-edit-history-active")).toHaveAttribute(
		"data-ms",
		"63900",
	);
	const pastes = block.getByTestId("answer-edit-history-pastes");
	await expect(pastes).toHaveAttribute("data-count", "1");
	await expect(pastes).toHaveAttribute("data-chars", "120");
	const large = block.getByTestId("answer-edit-history-large");
	await expect(large).toHaveCount(1);
	await expect(large).toHaveAttribute("data-kind", "paste");
	await expect(large).toHaveAttribute("data-length", "120");
	await expect(large).toHaveAttribute("data-at", NORMAL_FIRST_AT.toISOString());
	await expect(block.getByTestId("answer-edit-history-first")).toHaveAttribute(
		"data-at",
		NORMAL_FIRST_AT.toISOString(),
	);
	await expect(block.getByTestId("answer-edit-history-last")).toHaveAttribute(
		"data-at",
		NORMAL_LAST_AT.toISOString(),
	);
	await expect(block.getByTestId("answer-edit-history-state")).toHaveAttribute(
		"data-state",
		"complete",
	);
	await expect(block.getByTestId("answer-edit-history-gap")).toHaveCount(0);
	await expect(block.getByTestId("answer-edit-history-off")).toHaveCount(0);
});

test("the block says the data are hints seen in the browser, not proof of authorship", async ({
	page,
}) => {
	const world = await makeWorld();
	await seedNormalHistory(world);
	await logInAs(page, world.instructor);
	await page.goto(attemptHref(world));

	const block = card(page, 1).getByTestId("answer-edit-history");
	await openBlock(block);

	await expect(
		block.getByTestId("answer-edit-history-disclaimer"),
	).toBeVisible();
	await expect(
		block.getByTestId("answer-edit-history-disclaimer"),
	).not.toBeEmpty();
});

test("only followed questions get a block", async ({ page }) => {
	const world = await makeWorld();
	await seedNormalHistory(world);
	await submitAnswer(world, world.slugs.code, "print(1)");
	await logInAs(page, world.instructor);

	await page.goto(attemptHref(world));

	// Cards 1 and 2 are the text and the code essay, card 3 is the multiple choice.
	await expect(card(page, 1).getByTestId("answer-edit-history")).toHaveCount(1);
	await expect(card(page, 2).getByTestId("answer-edit-history")).toHaveCount(1);
	await expect(card(page, 3).getByTestId("answer-edit-history")).toHaveCount(0);
	await expect(page.getByTestId("answer-edit-history")).toHaveCount(2);
});

test("an answer with no batch shows the state none", async ({ page }) => {
	const world = await makeWorld();
	await submitAnswer(world, world.slugs.text, "typed elsewhere");
	await logInAs(page, world.instructor);

	await page.goto(attemptHref(world));

	const block = card(page, 1).getByTestId("answer-edit-history");
	await openBlock(block);
	await expect(block.getByTestId("answer-edit-history-state")).toHaveAttribute(
		"data-state",
		"none",
	);
	await expect(block.getByTestId("answer-edit-history-off")).toHaveCount(0);
});

test("a marker, a rebase and a final gap are listed with their sizes", async ({
	page,
}) => {
	const world = await makeWorld();
	await seedGappedHistory(world);
	await logInAs(page, world.instructor);

	await page.goto(attemptHref(world));

	const block = card(page, 1).getByTestId("answer-edit-history");
	await openBlock(block);
	const gaps = block.getByTestId("answer-edit-history-gap");
	await expect(gaps).toHaveCount(3);
	const marker = block.locator(
		'[data-testid="answer-edit-history-gap"][data-type="marker"]',
	);
	await expect(marker).toHaveAttribute("data-reason", "input-lost");
	const rebase = block.locator(
		'[data-testid="answer-edit-history-gap"][data-type="rebase"]',
	);
	// "quick" (5) out, "slow" (4) in.
	await expect(rebase).toHaveAttribute("data-removed", "5");
	await expect(rebase).toHaveAttribute("data-inserted", "4");
	const final = block.locator(
		'[data-testid="answer-edit-history-gap"][data-type="final"]',
	);
	// " Done." (6) in.
	await expect(final).toHaveAttribute("data-removed", "0");
	await expect(final).toHaveAttribute("data-inserted", "6");
});

test("an incomplete history is marked as such", async ({ page }) => {
	const world = await makeWorld();
	receiptOf(await sendBatch(world, appendBatch("", "abc", { batchId: "b1" })));
	await submitAnswer(world, world.slugs.text, "abc");
	await prisma.answerEditHistory.update({
		where: { responseId: world.attempt.id },
		data: { incompleteAt: new Date() },
	});
	await logInAs(page, world.instructor);

	await page.goto(attemptHref(world));

	const block = card(page, 1).getByTestId("answer-edit-history");
	await openBlock(block);
	await expect(block.getByTestId("answer-edit-history-state")).toHaveAttribute(
		"data-state",
		"incomplete",
	);
});

test("with the switch off the block says so and still shows what was recorded before", async ({
	page,
}) => {
	const world = await makeWorld();
	await seedNormalHistory(world);
	await db.exam.setAnswerHistory(
		{ course: world.course.id, slug: world.exam.slug },
		false,
		FULL_ACCESS,
	);
	await logInAs(page, world.instructor);

	await page.goto(attemptHref(world));

	const block = card(page, 1).getByTestId("answer-edit-history");
	await openBlock(block);
	await expect(block.getByTestId("answer-edit-history-off")).toBeVisible();
	await expect(block.getByTestId("answer-edit-history-off")).not.toBeEmpty();
	await expect(block.getByTestId("answer-edit-history-active")).toHaveAttribute(
		"data-ms",
		"63900",
	);
});

test("a practice exam on the default shows only the line that the recording is off", async ({
	page,
}) => {
	const world = await makeWorld({ type: "PRACTICE" });
	await submitAnswer(world, world.slugs.text, "practice answer");
	await logInAs(page, world.instructor);

	await page.goto(attemptHref(world));

	const block = card(page, 1).getByTestId("answer-edit-history");
	await openBlock(block);
	await expect(block.getByTestId("answer-edit-history-off")).toBeVisible();
	for (const id of [
		"active",
		"first",
		"last",
		"pastes",
		"large",
		"gap",
		"state",
	]) {
		await expect(block.getByTestId(`answer-edit-history-${id}`)).toHaveCount(0);
	}
});

test.describe("the student never sees the history", () => {
	/// A finished attempt of the exam, with the normal history.
	async function finishedWorld() {
		const world = await makeWorld();
		await seedNormalHistory(world);
		await db.response.finish(
			{ course: world.course.id, exam: world.exam.slug },
			{ actor: world.student },
		);
		await prisma.exam.update({
			where: { id: world.exam.id },
			data: { status: "COMPLETED" },
		});
		return world;
	}

	async function expectNoHistory(page: Page) {
		await expect(page.getByTestId("answer-edit-history")).toHaveCount(0);
		const html = await page.content();
		expect(html).not.toContain("answer-edit-history");
		expect(html).not.toContain("63900");
		expect(html).not.toContain(NORMAL_FIRST_AT.toISOString());
		expect(html).not.toContain(NORMAL_LAST_AT.toISOString());
	}

	test("not on their own attempt page", async ({ page }) => {
		const world = await finishedWorld();
		await logInAs(page, world.student);

		await page.goto(attemptHref(world));

		await expectNoHistory(page);
	});

	test("not on the exam page, where they read the result", async ({ page }) => {
		const world = await finishedWorld();
		await logInAs(page, world.student);

		await page.goto(examHref(world));

		await expectNoHistory(page);
	});
});
