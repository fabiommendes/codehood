import { randomUUID } from "node:crypto";
import { prisma } from "@/db/client";
import {
	all,
	CORRECT,
	codeWorld,
	PARTIAL,
	QUESTION,
	type Verdicts,
} from "./code-grading-support";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase } from "./stories/helpers";

// The grading page of a code question: the queue panel with its failures, and
// the sends of each answer with every case of the worker's report.

test.beforeEach(resetDatabase);

const partial: Verdicts = { ...all("pass"), negatives: "fail" };
const CRASH = "elm-test exited with status 137 (killed, out of memory)";

/// A world with one corrected, one crashed and one waiting send, grading page open.
async function queue(page: Parameters<typeof logInAs>[0]) {
	const world = await codeWorld();
	const graded = await world.student("graded-student");
	const crashed = await world.student("crashed-student");
	const waiting = await world.student("waiting-student");
	await world.sendAndGrade(graded, PARTIAL, partial);
	await world.sendAndGrade(graded, CORRECT, all("pass"));
	await world.sendAndCrash(crashed, CORRECT, CRASH);
	await world.send(waiting, CORRECT);
	await world.close([graded, crashed, waiting]);
	await logInAs(page, world.instructor);
	return { world, graded };
}

const count = (page: Parameters<typeof logInAs>[0], state: string) =>
	page.locator(`[data-code-queue] [data-queue-state=${state}] [data-count]`);

test("the panel counts the jobs by state and lists the failures", async ({
	page,
}) => {
	const { world } = await queue(page);
	await page.goto(`${world.href}/grading/${QUESTION}`);

	await expect(count(page, "DONE")).toHaveText("2");
	await expect(count(page, "FAILED")).toHaveText("1");
	await expect(count(page, "QUEUED")).toHaveText("1");
	await expect(count(page, "CLAIMED")).toHaveText("0");
	const failure = page.locator("[data-code-queue] [data-failure]");
	await expect(failure).toHaveCount(1);
	await expect(failure).toContainText("crashed-student");
	await expect(failure).toContainText(CRASH);
});

test("requeue failures puts the failed job back in the queue", async ({
	page,
}) => {
	const { world } = await queue(page);
	await page.goto(`${world.href}/grading/${QUESTION}`);

	await page.locator("[data-action=requeue-failed]").click();

	await expect(count(page, "FAILED")).toHaveText("0");
	await expect(count(page, "QUEUED")).toHaveText("2");
	await expect(page.locator("[data-failure]")).toHaveCount(0);
	expect(await prisma.gradingJob.count({ where: { state: "FAILED" } })).toBe(0);
});

test("the panel says when each worker key was last seen", async ({ page }) => {
	const { world } = await queue(page);
	const key = (name: string, lastUsedAt: Date | null) =>
		prisma.apiKey.create({
			data: {
				publicId: randomUUID(),
				keyHash: randomUUID(),
				name,
				kind: "BOT",
				createdById: world.instructor.username,
				lastUsedAt,
			},
		});
	await key("runner-a", new Date(Date.now() - 3 * 3_600_000));
	await key("runner-b", null);
	await page.goto(`${world.href}/grading/${QUESTION}`);

	const seen = page.locator("[data-worker-seen]");
	await expect(seen).toContainText("Worker runner-a seen 3 hours ago");
	await expect(seen).toContainText("Worker runner-b never seen");
});

test("each answer shows its sends, every case and which ones are hidden", async ({
	page,
}) => {
	const { world, graded } = await queue(page);
	await page.goto(`${world.href}/grading/${QUESTION}?view=list&names=1`);

	const answer = page.locator("article").filter({ hasText: graded.name });
	const sends = answer.locator("[data-code-sends] [data-send]");
	await expect(sends).toHaveCount(2);
	await expect(sends.nth(0)).not.toHaveAttribute("data-counts", "true");
	await expect(sends.nth(1)).toHaveAttribute("data-counts", "true");
	await expect(sends.nth(1).locator("[data-send-discounted]")).toBeVisible();

	const cases = sends.nth(0).locator("[data-case]");
	await expect(cases).toHaveCount(4);
	await expect(
		sends.nth(0).locator("[data-case][data-hidden=false]"),
	).toHaveCount(2);
	const hidden = sends.nth(0).locator("[data-case][data-hidden=true]");
	await expect(hidden).toHaveCount(2);
	await expect(hidden.nth(0)).toContainText("longa");
	await expect(hidden.nth(1)).toContainText("negativos");
	await expect(hidden.nth(1)).toContainText("Expected");
	await expect(hidden.nth(1).locator("[data-verdict=fail]")).toHaveCount(0);
});

test("the one-at-a-time view shows the sends too", async ({ page }) => {
	const { world } = await queue(page);
	await page.goto(`${world.href}/grading/${QUESTION}`);

	await expect(page.locator("[data-code-sends]")).toHaveCount(3);
	await expect(page.locator("[data-code-sends]:visible")).toHaveCount(1);
});

test("a student cannot read the panel", async ({ page }) => {
	const { world } = await queue(page);
	const student = await world.student("curious-student");
	await logInAs(page, student);
	await page.goto(`${world.href}/grading/${QUESTION}`);
	await expect(page.locator("[data-code-queue]")).toHaveCount(0);
});

test("the answer shows the discounted score and a model answer without the student's toggle", async ({
	page,
}) => {
	const { world, graded } = await queue(page);
	await page.goto(`${world.href}/grading/${QUESTION}?view=list&names=1`);

	const answer = page.locator("article").filter({ hasText: graded.name });
	await expect(answer.locator("p.text-lg.font-semibold")).toHaveText("80%");
	await expect(page.locator("[data-model-answer] .shiki")).toContainText(
		"List.sum xs",
	);
	await expect(page.getByText("Your answer")).toHaveCount(0);
});
