import { expect, test } from "@playwright/test";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

for (const page of ["", "/project"]) {
	test(`a roll call URL whose time slot is not a slug answers 404${page && ` (${page})`}`, async ({
		page: browser,
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
		await logInAs(browser, instructor);

		const response = await browser.goto(
			`${href}/roll-call/1/Aula%20Wed${page}`,
		);

		expect(response?.status()).toBe(404);
	});
}
