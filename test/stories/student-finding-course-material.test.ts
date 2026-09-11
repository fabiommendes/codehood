import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/core/actor";
import { type Course, courseService } from "@/db/services/course.service";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/utils/course-url";
import { logInAs, resetDatabase, seedUser } from "./helpers";

test.beforeEach(resetDatabase);

test("student: see my courses", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const enrolled = await persistedCourseFactory.create();
	await enroll(enrolled.id, student.username);
	const other = await persistedCourseFactory.create();

	await logInAs(page, student);
	await page.goto("/courses");

	await expect(
		page.getByRole("heading", { name: enrolled.discipline.name }),
	).toBeVisible();
	await expect(
		page.getByRole("heading", { name: other.discipline.name }),
	).toHaveCount(0);
});

test("student: be refused a course I am not enrolled in", async ({ page }) => {
	const student = await seedUser({ role: "STUDENT" });
	const theirs = await persistedCourseFactory.create();
	await enroll(theirs.id, student.username);
	const other = await persistedCourseFactory.create();

	await logInAs(page, student);

	await test.step("a course they are not in answers 403, naming it", async () => {
		const href = courseHref({
			discipline: other.discipline.slug,
			instructor: other.instructor.username,
			edition: other.edition.slug,
		});
		const response = await page.goto(href);
		expect(response?.status()).toBe(403);
		await expect(
			page.getByText(`${other.instructor.username}_${other.edition.slug}`),
		).toBeVisible();
	});

	await test.step("a course that does not exist answers 404 instead", async () => {
		const response = await page.goto(
			`/${theirs.discipline.slug}/nobody_${theirs.edition.slug}`,
		);
		expect(response?.status()).toBe(404);
	});
});

test("student: be refused the instructor's pages on my own course", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await enroll(course.id, student.username);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, student);

	// Being in the course is not the same as running it.
	expect((await page.goto(`${href}/manage`))?.status()).toBe(403);
	expect((await page.goto(`${href}/roster`))?.status()).toBe(403);
});

//
// Utilities
//

/** Enrolls an already-seeded student, which the course factory's `students` cannot do. */
async function enroll(courseId: Course["id"], username: string) {
	await courseService.enroll({ courseId, userId: username }, FULL_ACCESS);
}
