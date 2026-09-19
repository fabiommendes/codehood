import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { fillField, logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

test("instructor: see who is enrolled", async ({ page }) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create(
		{ instructor: instructor.username },
		{ transient: { students: 3 } },
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, instructor);

	await test.step("the instructor's own course offers Manage and Roster", async () => {
		expect((await page.goto(`${href}/manage`))?.status()).toBe(200);
		expect((await page.goto(`${href}/roster`))?.status()).toBe(200);
	});

	await test.step("and the roster lists every enrolled student", async () => {
		for (const student of course.students) {
			await expect(
				page.getByRole("row").filter({ hasText: student.name }),
			).toBeVisible();
		}
	});
});

test("instructor: hand out one join link for the whole class", async ({
	page,
}) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, instructor);

	await test.step("instructor generates a link capped at 5 seats", async () => {
		await page.goto(`${href}/roster`);
		await page.getByRole("button", { name: "Invite link" }).click();
		await fillField(page, "Limit to N uses (optional)", "5");
		await page.getByRole("button", { name: "Generate link" }).click();
	});

	const link = page.locator("#invite-url");
	await expect(link).toHaveValue(/\/invite\/.+/);

	await test.step("and anyone holding it is offered a place in the class", async () => {
		const url = await link.inputValue();
		// "Anyone" in the story means someone with no account and no session.
		await page.context().clearCookies();
		await page.goto(url);
		await expect(page.getByText("You're accepting an invite")).toBeVisible();
		await expect(page.locator("strong")).toHaveText("student");
	});

	// The cap is the part the UI cannot show back, and the part an instructor
	// is relying on when they post the link publicly.
	const invites = await db.invite.findMany(
		{ courseId: course.id, kind: "CLASSROOM" },
		FULL_ACCESS,
	);
	expect(invites).toHaveLength(1);
	expect(invites[0]?.maxUses).toBe(5);
});
