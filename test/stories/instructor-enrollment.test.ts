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

test("instructor: Enroll the room with a passphrase", async ({ page }) => {
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

	const code = page.locator("#passphrase-value");

	await test.step("before day one there is no code to read out", async () => {
		await page.goto(`${href}/roster`);
		await page.getByRole("button", { name: "Passphrase" }).click();
		await expect(
			page.getByText("No active passphrase — generate one below."),
		).toBeVisible();
	});

	await test.step("the instructor generates one and it goes on the projector", async () => {
		await page.getByRole("button", { name: "Renew passphrase" }).click();
		await expect(code).toHaveText(/^[A-Z0-9]{6}$/);
		await expect(page.getByText(/^live until /)).toBeVisible();
	});

	const value = await code.textContent();

	await test.step("reading it out again shows the same code, not a new one", async () => {
		await page.goto(`${href}/roster`);
		await page.getByRole("button", { name: "Passphrase" }).click();
		await expect(code).toHaveText(value as string);
	});

	// The short life is the whole point of a passphrase over an invite link,
	// and it is the one part the page states rather than demonstrates.
	const [passphrase] = await db.passphrase.findMany(
		{ courseId: course.id },
		FULL_ACCESS,
	);
	expect(passphrase?.value).toBe(value);
	const lifetimeMin =
		(passphrase!.expiresAt.getTime() - passphrase!.createdAt.getTime()) /
		60_000;
	expect(lifetimeMin).toBeLessThanOrEqual(5);

	await test.step("renewing replaces it, so a code read out earlier stops being the one on screen", async () => {
		await page.getByRole("button", { name: "Renew passphrase" }).click();
		await expect(code).not.toHaveText(value as string);
		await expect(code).toHaveText(/^[A-Z0-9]{6}$/);
	});
});

test("instructor: Drop and re-enroll a student", async ({ page }) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create(
		{ instructor: instructor.username },
		{ transient: { students: 1 } },
	);
	const student = course.students[0]!;
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	});

	await test.step("the student is in the course to begin with", async () => {
		await logInAs(page, student);
		expect((await page.goto(href))?.status()).toBe(200);
	});

	await test.step("the instructor drops them from the roster", async () => {
		await page.context().clearCookies();
		await logInAs(page, instructor);
		await page.goto(`${href}/roster`);

		const row = page.getByRole("row").filter({ hasText: student.name });
		await row.getByRole("button", { name: "Drop" }).click();

		const dialog = page.getByRole("dialog").filter({
			hasText: `Drop ${student.name} from this course?`,
		});
		await dialog.getByRole("button", { name: "Drop", exact: true }).click();

		await expect(page.getByText("No students enrolled yet.")).toBeVisible();
	});

	await test.step("and their access to the course ends immediately", async () => {
		await page.context().clearCookies();
		await logInAs(page, student);
		expect((await page.goto(href))?.status()).not.toBe(200);
	});

	// The promise the page makes while dropping — "nothing is deleted" — is the
	// half the UI cannot show back, and the half the instructor is relying on
	// when the drop turns out to be a mistake.
	const enrollment = await db.enrollment.findOne(
		{ courseId: course.id, username: student.username },
		FULL_ACCESS,
	);
	expect(enrollment).toMatchObject({ status: "DROPPED" });

	await test.step("re-enrolling restores the original enrollment rather than starting a new one", async () => {
		await page.context().clearCookies();
		await logInAs(page, instructor);
		await page.goto(`${href}/roster`);
		await page.getByRole("button", { name: "Add student" }).click();
		await fillField(page, "Email or username", student.username);
		await page.getByRole("button", { name: "Add", exact: true }).click();
		await expect(
			page.getByRole("row").filter({ hasText: student.name }),
		).toBeVisible();

		const restored = await db.enrollment.findOne(
			{ courseId: course.id, username: student.username },
			FULL_ACCESS,
		);
		expect(restored).toMatchObject({ status: "ACTIVE" });
		expect(restored?.enrolledAt).toEqual(enrollment?.enrolledAt);

		await page.context().clearCookies();
		await logInAs(page, student);
		expect((await page.goto(href))?.status()).toBe(200);
	});
});

test("instructor: Invite a student personally", async ({ page }) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: instructor.username,
		edition: course.edition.slug,
	});
	const existing = await seedUser({
		role: "STUDENT",
		name: "Already Signed Up",
		username: "personal-existing",
		email: "personal-existing@codehood.test",
	});

	await logInAs(page, instructor);

	await test.step("a student who already has an account is enrolled on the spot", async () => {
		await page.goto(`${href}/roster`);
		await page.getByRole("button", { name: "Add student" }).click();
		await fillField(page, "Email or username", existing.email);
		await page.getByRole("button", { name: "Add", exact: true }).click();

		await expect(
			page.getByRole("row").filter({ hasText: existing.name }),
		).toBeVisible();
	});

	let inviteUrl = "";
	await test.step("an address with no account gets an invite link instead", async () => {
		await page.getByRole("button", { name: "Add student" }).click();
		await fillField(
			page,
			"Email or username",
			"personal-invitee@codehood.test",
		);
		await page.getByRole("button", { name: "Add", exact: true }).click();

		const link = page.locator("#personal-invite-url");
		await expect(link).toHaveValue(/\/invite\/.+/);
		inviteUrl = await link.inputValue();
	});

	await test.step("and redeeming it creates the account already enrolled", async () => {
		await page.context().clearCookies();
		await page.goto(inviteUrl);

		// Tied to the address the instructor typed: the redeemer cannot swap it.
		await expect(
			page.getByRole("group", { name: "Email", exact: true }).locator("input"),
		).toHaveValue("personal-invitee@codehood.test");

		await fillField(page, "Username", "personal-invitee");
		await fillField(page, "Name", "Invited Personally");
		await fillField(page, "GitHub username", "personal-invitee");
		await fillField(page, "School id", "personal-invitee");
		await fillField(page, "Password", "correcthorse");
		await fillField(page, "Confirm password", "correcthorse");
		await page.getByRole("button", { name: "Create account" }).click();

		await page.goto("/courses");
		await expect(
			page.getByRole("heading", { name: course.discipline.name }),
		).toBeVisible();
	});

	// The invite is single-use and carries the course, which is what makes
	// redeeming it an enrollment rather than a bare sign-up.
	const invites = await db.invite.findMany(
		{ courseId: course.id, kind: "PERSONAL" },
		FULL_ACCESS,
	);
	expect(invites).toHaveLength(1);
	expect(invites[0]).toMatchObject({
		maxUses: 1,
		email: "personal-invitee@codehood.test",
		invitedRole: "STUDENT",
	});
});
