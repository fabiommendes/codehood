import { db } from "@/db";
import { prisma } from "@/db/client";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";
import {
	gradesMessage,
	objectiveExam,
	objectiveLabel,
} from "./stories/objective-support";

// The grading page of a question the library grades by itself: names, view links, the empty cases, sanctions and who may open it.

test.beforeEach(resetDatabase);

const NAMES = ["Ana Prado", "Bia Lima", "Caio Nunes", "Davi Rocha"];

test("the names of the students show with no query, with names=0 and with names=1", async ({
	page,
}) => {
	const world = await objectiveExam("op-names");
	await logInAs(page, world.teacher);

	for (const query of ["", "?names=0", "?names=1"]) {
		await page.goto(`${world.choiceUrl}${query}`);

		// Bia has a request and Ana was changed by hand: both are named, never by username.
		const body = page.locator("body");
		for (const name of ["Ana Prado", "Bia Lima"]) {
			await expect(body).toContainText(name);
		}
		// No switch to anonymous grading.
		await expect(page.getByRole("switch")).toHaveCount(0);
	}
});

test("the arrows between questions keep the list view of a manual question", async ({
	page,
}) => {
	const world = await objectiveExam("op-view");
	await logInAs(page, world.teacher);

	await page.goto(`${world.choiceUrl}?view=list`);
	await expect(
		page.getByRole("link", { name: gradesMessage("grades_question_next") }),
	).toHaveAttribute("href", /view=list/);
	await page.goto(`${world.orderUrl}?view=list`);
	await expect(
		page.getByRole("link", {
			name: gradesMessage("grades_question_previous"),
		}),
	).toHaveAttribute("href", /view=list/);

	await page.goto(world.choiceUrl);
	await expect(
		page.getByRole("link", { name: gradesMessage("grades_question_next") }),
	).not.toHaveAttribute("href", /view=list/);
});

test("a question with every answer graded and no request has no needs-attention section and no changed-by-hand list", async ({
	page,
}) => {
	const world = await objectiveExam("op-quiet");
	await logInAs(page, world.teacher);

	await page.goto(world.orderUrl);

	await expect(page.getByTestId("summary")).toContainText("4");
	await expect(page.getByTestId("summary")).toContainText(/75\s*%/);
	await expect(page.locator('a[href="#attention"]')).toHaveCount(0);
	await expect(page.locator("section#attention")).toHaveCount(0);
	await expect(page.locator("section#overrides")).toHaveCount(0);
	await expect(page.getByRole("note")).toBeVisible();
	await expect(
		page.getByRole("link", { name: objectiveLabel("edit_question") }),
	).toBeVisible();
});

test("an ordering question groups the whole orders, three students on the key order and one on another", async ({
	page,
}) => {
	const world = await objectiveExam("op-order");
	await logInAs(page, world.teacher);

	await page.goto(world.orderUrl);

	const key = page.getByRole("row").filter({ hasText: /75\s*%/ });
	await expect(key.first()).toContainText("3");
	const other = page.getByRole("row").filter({ hasText: /25\s*%/ });
	await expect(other.first()).toContainText("1");
});

test("a sanction on the question is listed as a sanction with the grade before and after, and undo revokes it", async ({
	page,
}) => {
	const world = await objectiveExam("op-sanction");
	await db.examAdjustment.create(
		{
			course: world.course.id,
			exam: world.exam.slug,
			usernames: [world.caio.username],
			question: "q-choice",
			op: "FACTOR",
			value: "0",
			reason: "Looked at the neighbour",
		},
		{ actor: world.teacher },
	);
	await logInAs(page, world.teacher);

	await page.goto(world.choiceUrl);

	const overrides = page.locator("section#overrides");
	await expect(overrides.getByRole("heading")).toContainText("(2)");
	const caio = overrides.getByRole("row").filter({ hasText: "Caio Nunes" });
	await expect(caio).toContainText(/100\s*%/);
	await expect(caio).toContainText(/0\s*%/);
	// A sanction is not edited as a grade: it only has an undo.
	await expect(
		caio.getByRole("button", { name: objectiveLabel("change_grade") }),
	).toHaveCount(0);

	await caio.getByRole("button", { name: objectiveLabel("undo") }).click();

	await expect(overrides.getByRole("heading")).toContainText("(1)");
	await expect(overrides).not.toContainText("Caio Nunes");
	const adjustments = await prisma.examAdjustment.findMany({
		where: { response: { authorId: world.caio.username } },
		select: { revokedAt: true },
	});
	expect(adjustments).toHaveLength(1);
	expect(adjustments[0]?.revokedAt).not.toBeNull();
});

test("a student of the course gets 403 and sees no name", async ({ page }) => {
	const world = await objectiveExam("op-student");
	await logInAs(page, world.ana);

	const response = await page.goto(world.choiceUrl);

	expect(response?.status()).toBe(403);
	await expect(page.locator("body")).not.toContainText("Bia Lima");
});

test("an instructor of another course gets 403", async ({ page }) => {
	const world = await objectiveExam("op-outsider");
	const outsider = await seedUser({
		role: "INSTRUCTOR",
		username: "op-outsider-other",
	});
	await logInAs(page, outsider);

	const response = await page.goto(world.choiceUrl);

	expect(response?.status()).toBe(403);
	await expect(page.locator("body")).not.toContainText("Bia Lima");
});

test("an anonymous visitor is sent to the login", async ({ page }) => {
	const world = await objectiveExam("op-anon");

	await page.goto(world.choiceUrl);

	await expect(page).toHaveURL(/\/login/);
	for (const name of NAMES) {
		await expect(page.locator("body")).not.toContainText(name);
	}
});
