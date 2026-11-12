import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import {
	appendBatch,
	makeWorld,
	storedField,
} from "./answer-edit-service-support";
import { expect, type Page, test } from "./fixtures";
import { parseDevalue } from "./helpers/devalue-lite";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

// R30 and R31: the toggle on the exam page, the Action behind it, and what a
// student can and cannot see of it.

test.beforeEach(resetDatabase);

function segments(world: Awaited<ReturnType<typeof makeWorld>>) {
	return {
		discipline: world.course.discipline.slug,
		course: `${world.course.instructor.username}_${world.course.edition.slug}`,
		exam: world.exam.slug,
	};
}

function examUrl(world: Awaited<ReturnType<typeof makeWorld>>): string {
	const s = segments(world);
	return `${courseHref({ discipline: s.discipline, instructor: world.instructor.username, edition: world.course.edition.slug })}/exams/${s.exam}`;
}

const toggle = (page: Page) =>
	page.getByTestId("answer-history-setting").getByRole("checkbox");

test("the instructor sees the default of the type, flips it and it survives a reload", async ({
	page,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	await logInAs(page, world.instructor);
	await page.goto(examUrl(world));

	await expect(toggle(page)).toBeChecked();
	await toggle(page).click();
	await expect(toggle(page)).not.toBeChecked();
	await expect(toggle(page)).toBeEnabled();
	expect(
		(await prisma.exam.findUniqueOrThrow({ where: { id: world.exam.id } }))
			.answerHistory,
	).toBe(false);

	await page.reload();
	await expect(toggle(page)).not.toBeChecked();
	await toggle(page).click();
	await expect(toggle(page)).toBeChecked();
	await page.reload();
	await expect(toggle(page)).toBeChecked();
});

test("a PRACTICE exam in the default shows the toggle off and can turn it on", async ({
	page,
}) => {
	const world = await makeWorld({ type: "PRACTICE" });
	await logInAs(page, world.instructor);
	await page.goto(examUrl(world));

	await expect(toggle(page)).not.toBeChecked();
	await toggle(page).click();
	await expect(toggle(page)).toBeChecked();
	await page.reload();
	await expect(toggle(page)).toBeChecked();
});

test("a student sees no trace of the switch on the exam page", async ({
	page,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	await logInAs(page, world.student);
	await page.goto(examUrl(world));

	await expect(
		page.getByRole("heading", { name: world.exam.title }),
	).toBeVisible();
	await expect(page.getByTestId("answer-history-setting")).toHaveCount(0);
	expect((await page.content()).toLowerCase()).not.toContain("edit history");
});

test("the action refuses a student, a stranger and a call without a session", async ({
	page,
}) => {
	const world = await makeWorld();
	const body = { ...segments(world), enabled: false };
	const stored = async () =>
		(await prisma.exam.findUniqueOrThrow({ where: { id: world.exam.id } }))
			.answerHistory;

	const anonymous = await page.request.post("/_actions/exam.setAnswerHistory", {
		data: body,
	});
	expect(anonymous.status()).toBeGreaterThanOrEqual(400);
	expect(await stored()).toBeNull();

	const stranger = await seedUser({ role: "INSTRUCTOR" });
	await persistedCourseFactory.create({ instructor: stranger.username });
	for (const user of [world.student, stranger]) {
		await page.context().clearCookies();
		await logInAs(page, user);
		const response = await page.request.post(
			"/_actions/exam.setAnswerHistory",
			{
				data: body,
			},
		);
		expect(response.status()).toBe(403);
		expect(await stored()).toBeNull();
	}
});

test("after the instructor switches it off the history is refused and exam.answer reports it", async ({
	page,
}) => {
	const world = await makeWorld({ type: "EXAM" });
	await logInAs(page, world.instructor);
	const off = await page.request.post("/_actions/exam.setAnswerHistory", {
		data: { ...segments(world), enabled: false },
	});
	expect(off.status()).toBe(200);
	expect(parseDevalue(await off.text())).toEqual({ answerHistory: false });

	await page.context().clearCookies();
	await logInAs(page, world.student);
	const answer = await page.request.post("/_actions/exam.answer", {
		data: { ...segments(world), question: world.slugs.text, payload: "text" },
	});
	expect(answer.status()).toBe(200);
	expect(parseDevalue(await answer.text())).toMatchObject({
		answerHistory: false,
	});

	const sent = await page.request.post("/_actions/answerHistory.send", {
		data: {
			...segments(world),
			attempt: world.attempt.publicId,
			fields: [
				{
					question: world.slugs.text,
					field: "answer",
					batch: appendBatch("", "text"),
				},
			],
		},
	});
	expect(sent.status()).toBe(200);
	const body = parseDevalue(await sent.text()) as {
		enabled: boolean;
		results: unknown[];
	};
	expect(body.enabled).toBe(false);
	expect(body.results[0]).toMatchObject({ kind: "closed", reason: "disabled" });
	expect(await storedField(world)).toBeNull();
});
