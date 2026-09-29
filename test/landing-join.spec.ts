import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedPassphraseFactory } from "@/fixtures/passphrase.factory";
import { fillField, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

test("a code typed on the landing page survives logging in and joins the course", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	const code = await persistedPassphraseFactory.create({ course: course.id });

	await page.goto("/");
	await page.getByLabel("Course code").fill(code.value);
	await page.getByRole("button", { name: "Join" }).click();

	await expect(page).toHaveURL(/\/login\?next=/);
	await fillField(page, "Email or username", student.username);
	await fillField(page, "Password", student.password);
	await page.getByRole("button", { name: "Log in" }).click();

	await expect(page).toHaveURL(/\/courses\/join\?code=/);
	await expect(page.getByLabel("Course code")).toHaveValue(code.value);
	await page.getByRole("button", { name: "Join" }).click();

	await expect(page).toHaveURL((url) => url.searchParams.has("joined"));
	const enrollment = await db.enrollment.findOne(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	expect(enrollment?.status).toBe("ACTIVE");
});

for (const next of [
	"//evil.example",
	"https://evil.example",
	"/\\evil.example",
]) {
	test(`login ignores a next of ${next} and lands on the home page`, async ({
		page,
	}) => {
		const student = await seedUser({ role: "STUDENT" });

		await page.goto(`/login?next=${encodeURIComponent(next)}`);
		await fillField(page, "Email or username", student.username);
		await fillField(page, "Password", student.password);
		await page.getByRole("button", { name: "Log in" }).click();

		await expect(page).toHaveURL(/^http:\/\/localhost:\d+\/$/);
	});
}
