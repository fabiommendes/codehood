import { expect, test } from "@playwright/test";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

test("the top bar says who is signed in and holds Profile and Log out", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT", name: "Grace Student" });
	await logInAs(page, student);
	await page.goto("/courses");

	const menu = page.locator("details.dropdown");
	await expect(menu.locator("summary")).toContainText("Grace Student");
	await expect(menu.locator("summary")).toContainText("Student");

	const sidebar = page.locator(".drawer-side");
	await expect(sidebar.getByRole("link", { name: "Profile" })).toHaveCount(0);

	await menu.locator("summary").click();
	await expect(menu.getByRole("link", { name: "Profile" })).toHaveAttribute(
		"href",
		"/profile",
	);
	await menu.getByRole("button", { name: "Log out" }).click();
	await page.goto("/profile");
	await expect(page).toHaveURL(/\/login/);
});

test("sidebar courses show code and edition, and mark the ones the user teaches", async ({
	page,
}) => {
	const teacher = await seedUser({ role: "INSTRUCTOR" });
	const taught = await persistedCourseFactory.create({
		instructor: teacher.username,
	});
	const taken = await persistedCourseFactory.create(
		{},
		{ transient: { students: 1 } },
	);
	const [student] = taken.students;
	if (!student) throw new Error("the course fixture enrolled no student");

	const entry = (code: string) =>
		page.locator(".drawer-side a").filter({ hasText: code });

	await logInAs(page, teacher);
	await page.goto("/courses");
	const own = entry(taught.discipline.slug);
	await expect(own).toContainText(
		`${taught.discipline.slug} · ${taught.edition.slug}`,
	);
	await expect(own).toContainText("teaching");

	await page.context().clearCookies();
	await logInAs(page, student);
	await page.goto("/courses");
	const enrolled = entry(taken.discipline.slug);
	await expect(enrolled).toContainText(
		`${taken.discipline.slug} · ${taken.edition.slug}`,
	);
	await expect(enrolled).not.toContainText("teaching");
});
