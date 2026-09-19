import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { hashToken } from "@/auth/token";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedInviteFactory } from "@/fixtures/invite.factory";
import { fillField, logIn, openTab, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

test("student: redeem a personal invite", async ({ page }) => {
	const course = await persistedCourseFactory.create();
	const invite = await persistedInviteFactory.create({
		kind: "PERSONAL",
		invitedRole: "STUDENT",
		email: "invitee@codehood.test",
		courseId: course.id,
		maxUses: 1,
		createdBy: course.instructor,
	});

	await test.step("the invite page says what is being joined", async () => {
		await page.goto(`/invite/${invite.token}`);
		await expect(page.getByText("You're accepting an invite")).toBeVisible();
	});

	// A personal invite renders its address into a `readonly` input, so the
	// redeemer cannot submit a different one. That is also why the service's
	// `email_mismatch` code is unreachable from this page. See
	// dev/issues/invite-address-cannot-be-changed.md.
	await test.step("the address it was issued to is pinned", async () => {
		const email = page
			.getByRole("group", { name: "Email", exact: true })
			.locator("input");
		await expect(email).toHaveValue("invitee@codehood.test");
		await expect(email).toHaveAttribute("readonly", "");
	});

	await test.step("student fills in their details and gets an account", async () => {
		await acceptInvite(page, {
			username: "invitee",
			name: "New Student",
			password: "correcthorse",
		});
		await expect(page).not.toHaveURL(/\/invite\//);
	});

	// The story promises the account lands "with the enrollment already in
	// place", so the course is on their list with no further action.
	await page.goto("/courses");
	await expect(
		page.getByRole("heading", { name: course.discipline.name }),
	).toBeVisible();

	const created = await db.user.findOne({ username: "invitee" }, FULL_ACCESS);
	expect(created?.role).toBe("STUDENT");

	await test.step("coming back to a spent link says it is used up", async () => {
		await page.context().clearCookies();
		await page.goto(`/invite/${invite.token}`);
		await expect(
			page.getByText("This invite has already been fully used."),
		).toBeVisible();
	});

	await test.step("a link left for weeks says it expired instead", async () => {
		const stale = await persistedInviteFactory.create({
			kind: "PERSONAL",
			invitedRole: "STUDENT",
			email: "late@codehood.test",
			courseId: course.id,
			createdBy: course.instructor,
		});
		await expire(stale.token);

		await page.goto(`/invite/${stale.token}`);
		await expect(page.getByText("This invite has expired.")).toBeVisible();
	});
});

test("student: redeem a classroom invite link", async ({ page }) => {
	const course = await persistedCourseFactory.create();
	const invite = await persistedInviteFactory.create({
		kind: "CLASSROOM",
		invitedRole: "STUDENT",
		email: null,
		courseId: course.id,
		maxUses: 5,
		createdBy: course.instructor,
	});

	// Not addressed to anyone, so the student supplies their own email.
	await page.goto(`/invite/${invite.token}`);
	await acceptInvite(page, {
		email: "classmate@codehood.test",
		username: "classmate",
		name: "A Classmate",
		password: "correcthorse",
	});

	await page.goto("/courses");
	await expect(
		page.getByRole("heading", { name: course.discipline.name }),
	).toBeVisible();
});

test("student: log in", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });

	await test.step("the username works", async () => {
		await logIn(page, student);
	});

	await test.step("and so does the email", async () => {
		await page.goto("/profile");
		await openTab(page, "Account");
		await page.getByRole("button", { name: "Log out everywhere" }).click();
		await logIn(page, { username: student.email, password: student.password });
	});

	await test.step("but the wrong password is refused, without saying which half was wrong", async () => {
		await page.goto("/login");
		await fillField(page, "Email or username", student.username);
		await fillField(page, "Password", "not-the-password");
		await page.getByRole("button", { name: "Log in" }).click();

		await expect(page).toHaveURL(/\/login/);
		await expect(
			page.getByText("Invalid email/username or password."),
		).toBeVisible();
	});
});

//
// Utilities
//

/**
 * Backdates an invite's expiry so the page treats it as stale.
 *
 * `InviteCreate` has no `expiresAt` — the service sets it — so the only way to
 * age one is to write the column.
 */
async function expire(token: string | undefined): Promise<void> {
	// `Invite.token` is optional on the entity: the service returns it only from
	// `create`, which is where these fixtures get theirs.
	if (!token) throw new Error("the invite fixture carries no token");

	await prisma.invite.update({
		where: { tokenHash: hashToken(token) },
		data: { expiresAt: new Date(Date.now() - 1000) },
	});
}

/** Fills the invite-acceptance form and submits it. */
async function acceptInvite(
	page: Page,
	details: { username: string; name: string; password: string; email?: string },
) {
	if (details.email) await fillField(page, "Email", details.email);
	await fillField(page, "Username", details.username);
	await fillField(page, "Name", details.name);
	await fillField(page, "GitHub username", details.username);
	await fillField(page, "School id", details.username);
	await fillField(page, "Password", details.password);
	await fillField(page, "Confirm password", details.password);
	await page.getByRole("button", { name: "Create account" }).click();
}
