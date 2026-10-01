import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { prisma } from "@/db/client";
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

test("the course home previews the three resources added last, newest first", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	// Added in this order, a day apart, with titles in the opposite order.
	const titles = ["Zeta notes", "Gamma notes", "Beta notes", "Alpha notes"];
	for (const [day, title] of titles.entries()) {
		const resource = await persistedResourceFactory.create({
			course: course.id,
			title,
		});
		await prisma.resource.update({
			where: { id: resource.id },
			data: { createdAt: new Date(Date.UTC(2026, 2, day + 1)) },
		});
	}
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, student);
	await page.goto(href);

	const section = page.locator("section", {
		has: page.getByRole("heading", { name: "Resources" }),
	});
	await expect(
		section
			.getByRole("link")
			.filter({ hasNotText: "View all" })
			.locator("p.font-medium"),
	).toHaveText(["Alpha notes", "Beta notes", "Gamma notes"]);
});
