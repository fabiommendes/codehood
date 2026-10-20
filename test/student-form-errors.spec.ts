import { expect, type Page, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedPassphraseFactory } from "@/fixtures/passphrase.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { codeAt } from "@/services/roll-call-code";
import {
	fillField,
	futureDate,
	logInAs,
	openTab,
	resetDatabase,
	seedUser,
} from "./stories/helpers";

/**
 * Per-field errors of the student-facing forms, without JavaScript: the page
 * that answers the POST puts the message in the field and keeps what was typed.
 */

test.use({ javaScriptEnabled: false });
test.beforeEach(resetDatabase);

const DAY = 24 * 60 * 60_000;

/// The field group named `label`.
function group(page: Page, label: string) {
	return page.getByRole("group", { name: label, exact: true });
}

/// A roll call that creates accounts, with its sign-up page open and a claim cookie set.
async function openSignUpPage(page: Page) {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
		startAt: new Date(Date.now() - 28 * DAY),
		endAt: new Date(Date.now() + 70 * DAY),
	});
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day: futureDate(0).day,
	});
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 0,
		title: "fe-Signup",
	});
	const created = await db.rollCall.create(
		{
			event: { course: course.id, week: 0, timeSlot: slot.id },
			actsAsInvite: true,
		},
		FULL_ACCESS,
	);
	const { secret } = await prisma.rollCall.findUniqueOrThrow({
		where: { id: created.id },
	});
	await page.goto(`/c/${created.id}/${codeAt(secret, new Date()).code}`);
}

/// Fills the sign-up form, defaulting to a valid new account.
async function signUp(page: Page, details: Record<string, string> = {}) {
	const values = {
		Name: "Nina Newbie",
		Email: "fe-nina@codehood.test",
		Username: "fe-nina",
		"GitHub username": "fe-nina-gh",
		"School id": "fe-nina-school",
		Password: "correcthorse",
		"Confirm password": "correcthorse",
		...details,
	};
	for (const [label, value] of Object.entries(values)) {
		await fillField(page, label, value);
	}
	await page.getByRole("button", { name: "Create account" }).click();
}

test("check-in sign-up: a taken username shows on the username field, keeping the rest", async ({
	page,
}) => {
	const taken = await seedUser({ role: "STUDENT" });
	await openSignUpPage(page);
	await signUp(page, { Username: taken.username });

	await expect(group(page, "Username")).toContainText(
		"That username is already in use.",
	);
	await expect(group(page, "Username").locator("input")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(group(page, "Name").locator("input")).toHaveValue("Nina Newbie");
	await expect(group(page, "Email").locator("input")).toHaveValue(
		"fe-nina@codehood.test",
	);
	await expect(group(page, "Password").locator("input")).toHaveValue("");
	await expect(group(page, "Email")).not.toContainText("already in use");
});

test("check-in sign-up: a taken email shows on the email field", async ({
	page,
}) => {
	const taken = await seedUser({ role: "STUDENT" });
	await openSignUpPage(page);
	await signUp(page, { Email: taken.email });

	await expect(group(page, "Email")).toContainText(
		"That email is already in use.",
	);
	await expect(group(page, "Username")).not.toContainText("already in use");
});

test("check-in sign-up: a short password is refused on the password field", async ({
	page,
}) => {
	await openSignUpPage(page);
	// The browser would stop a short password before it posts.
	await page
		.locator("form#check-in-sign-up")
		.evaluate((form: HTMLFormElement) => {
			form.noValidate = true;
		});
	await signUp(page, { Password: "short", "Confirm password": "short" });

	await expect(group(page, "Password")).toContainText(/at least 8/i);
	await expect(group(page, "Username").locator("input")).toHaveValue("fe-nina");
});

test("join by passphrase: a code no course uses is refused on the code field", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	await page.goto("/courses/join");
	await fillField(page, "Course code", "nope22");
	await page.getByRole("button", { name: "Join" }).click();

	await expect(group(page, "Course code")).toContainText(
		'No course uses the code "nope22".',
	);
	await expect(group(page, "Course code").locator("input")).toHaveAttribute(
		"aria-invalid",
		"true",
	);
	await expect(group(page, "Course code").locator("input")).toHaveValue(
		"nope22",
	);
});

test("join by passphrase: an expired code is refused on the code field", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	const stale = await persistedPassphraseFactory.create({ course: course.id });
	await db.passphrase.update(
		{ id: stale.id },
		{ expiresAt: new Date(Date.now() - 60_000) },
		FULL_ACCESS,
	);
	await logInAs(page, student);
	await page.goto("/courses/join");
	await fillField(page, "Course code", stale.value);
	await page.getByRole("button", { name: "Join" }).click();

	await expect(group(page, "Course code")).toContainText("has expired");
});

test("join by passphrase: the instructor of the course gets a form-level alert, not a field error", async ({
	page,
}) => {
	const course = await persistedCourseFactory.create();
	const live = await persistedPassphraseFactory.create({ course: course.id });
	await logInAs(page, course.instructor);
	await page.goto("/courses/join");
	await fillField(page, "Course code", live.value);
	await page.getByRole("button", { name: "Join" }).click();

	await expect(page.getByRole("alert")).toContainText("You teach this course");
	await expect(group(page, "Course code")).not.toContainText("You teach");
});

test("check-in code: a wrong code is refused on the code field", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	await logInAs(page, student);
	await page.goto("/check-in");
	await fillField(page, "Code", "ZZZZZZ");
	await page.getByRole("button", { name: "Register" }).click();

	await expect(group(page, "Code")).toContainText("That code is not valid.");
	await expect(group(page, "Code").locator("input")).toHaveValue("ZZZZZZ");
});

test("profile: a taken email shows on the email field, and a wrong current password on its own", async ({
	page,
}) => {
	const taken = await seedUser({ role: "STUDENT" });
	const me = await seedUser({ role: "STUDENT" });
	await logInAs(page, me);
	await page.goto("/profile");
	await fillField(page, "Email", taken.email);
	await page.getByRole("button", { name: "Save changes" }).click();
	await expect(group(page, "Email")).toContainText(
		"That email is already in use.",
	);

	await page.goto("/profile");
	await openTab(page, "Account");
	await fillField(page, "Current password", "not-my-password");
	await fillField(page, "New password", "brand-new-password");
	await fillField(page, "Confirm new password", "brand-new-password");
	await page.getByRole("button", { name: "Change password" }).click();
	await expect(group(page, "Current password")).toContainText(
		"Current password is incorrect.",
	);
});
