import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedResourceFactory } from "@/fixtures/resource.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

test("a link on the course home opens its site in another tab", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await persistedResourceFactory.create({
		course: course.id,
		slug: "outside-reading",
		title: "Outside reading",
		description: null,
		data: { type: "LINK", url: "https://www.example.com/reading" },
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, student);
	await page.goto(href);

	const row = page.getByRole("link", { name: /Outside reading/ });
	await expect(row).toHaveAttribute("href", "https://www.example.com/reading");
	await expect(row).toHaveAttribute("target", "_blank");
	await expect(row).toContainText("example.com");
});
