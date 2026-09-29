import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { hashToken } from "@/auth/token";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedInviteFactory } from "@/fixtures/invite.factory";
import { persistedPassphraseFactory } from "@/fixtures/passphrase.factory";
import { courseHref } from "@/urls";
import {
	fillField,
	logIn,
	logInAs,
	openTab,
	resetDatabase,
	seedUser,
} from "./helpers";

test.beforeEach(resetDatabase);

test("student: redeem a personal invite", async ({ page }) => {
	const course = await persistedCourseFactory.create();
	const invite = await persistedInviteFactory.create({
		kind: "PERSONAL",
		invitedRole: "STUDENT",
		email: "invitee@codehood.test",
		course: course.id,
		maxUses: 1,
		createdBy: course.instructor,
	});

	await test.step("the invite page says what is being joined", async () => {
		await page.goto(`/invite/${invite.token}`);
		await expect(page.getByText("You're accepting an invite")).toBeVisible();
	});

	// A personal invite renders its address into a `readonly` input, so the
	// redeemer cannot submit a different one. That is also why the service's
	// `email_mismatch` code is unreachable from this page.
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
			course: course.id,
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
		course: course.id,
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

	await test.step("signed out, the root URL is the marketing landing page", async () => {
		const response = await page.goto("/");
		expect(response?.status()).toBe(200);
		await expect(
			page.getByRole("heading", { name: /Run your course like a Git repo/ }),
		).toBeVisible();
	});

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

	await test.step("signed in, the root URL shows their home page", async () => {
		await logIn(page, student);
		await page.goto("/");
		await expect(page).toHaveURL("/");
		await expect(
			page.getByRole("heading", { name: "Run your course like a Git repo." }),
		).toHaveCount(0);
		await expect(
			page.getByRole("link", { name: "Home" }).first(),
		).toHaveAttribute("aria-current", "page");
	});
});

test("student: join a course with an in-class passphrase", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	const live = await persistedPassphraseFactory.create({ course: course.id });
	const staleCourse = await persistedCourseFactory.create();
	const stale = await persistedPassphraseFactory.create({
		course: staleCourse.id,
	});
	await db.passphrase.update(
		{ id: stale.id },
		{ expiresAt: new Date(Date.now() - 60_000) },
		FULL_ACCESS,
	);
	const enrolledIn = (target: typeof course) =>
		db.enrollment.findOne(
			{ course: target.id, username: student.username },
			FULL_ACCESS,
		);

	await test.step("the join page is for signed-in users only", async () => {
		await page.goto("/courses/join");
		await expect(page).toHaveURL(/\/login/);
	});

	await test.step("a student with no courses is offered a way to join one", async () => {
		await logInAs(page, student);
		await page.goto("/courses");
		await expect(
			page.getByRole("link", { name: "Join a course" }).first(),
		).toHaveAttribute("href", "/courses/join");
	});

	const submitCode = async (typed: string) => {
		await page.goto("/courses/join");
		await page.getByLabel("Course code").fill(typed);
		await page.getByRole("button", { name: "Join" }).click();
	};

	await test.step("a code no course uses is refused, keeping what was typed", async () => {
		await submitCode("nope22");
		await expect(page).toHaveURL(/\/courses\/join/);
		await expect(page.getByText("No course uses the code")).toBeVisible();
		await expect(page.getByLabel("Course code")).toHaveValue("nope22");
	});

	await test.step("an expired code says so, and enrolls nobody", async () => {
		await submitCode(stale.value);
		await expect(page).toHaveURL(/\/courses\/join/);
		await expect(page.getByText("has expired")).toBeVisible();
		await expect(page.getByLabel("Course code")).toHaveValue(stale.value);
		expect(await enrolledIn(staleCourse)).toBeNull();
	});

	await test.step("a live code, typed lowercase with spaces, lands on the course home", async () => {
		await submitCode(`  ${live.value.toLowerCase()}  `);
		const href = courseHref({
			discipline: course.discipline.slug,
			instructor: course.instructor.username,
			edition: course.edition.slug,
		});
		await expect(page).toHaveURL(
			(url) => url.pathname === href && url.searchParams.has("joined"),
		);
		await expect(
			page.getByText(`You joined ${course.discipline.name}`),
		).toBeVisible();
		expect((await enrolledIn(course))?.status).toBe("ACTIVE");
	});

	await test.step("the course is on their list, and joining another stays on offer", async () => {
		await page.goto("/courses");
		await expect(
			page.getByRole("heading", { name: course.discipline.name }),
		).toBeVisible();
		await expect(
			page.getByRole("link", { name: "Join a course" }).first(),
		).toHaveAttribute("href", "/courses/join");
	});

	await test.step("the course's own instructor is told they teach it", async () => {
		await page.context().clearCookies();
		await logInAs(page, course.instructor);
		await submitCode(live.value);
		await expect(page).toHaveURL(/\/courses\/join/);
		await expect(page.getByText("You teach this course")).toBeVisible();
		await expect(page.getByLabel("Course code")).toHaveValue(live.value);
		expect(
			await db.enrollment.findOne(
				{ course: course.id, username: course.instructor.username },
				FULL_ACCESS,
			),
		).toBeNull();
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
