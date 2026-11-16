import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { courseHref } from "@/urls";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase } from "./stories/helpers";

test.beforeEach(resetDatabase);

test("the question page draws the question as Q1 of an exam, at 100 points", async ({
	page,
}) => {
	const course = await persistedCourseFactory.create();
	const question = await persistedQuestionFactory.create({
		course: course.id,
		slug: "framed-question",
	});
	await logInAs(page, course.instructor);
	await page.goto(
		`${courseHref({
			discipline: course.discipline.slug,
			instructor: course.instructor.username,
			edition: course.edition.slug,
		})}/questions/${question.slug}`,
	);

	const frame = page.locator("section#question-1");
	await expect(frame).toBeVisible();
	await expect(frame.locator("h3")).toContainText(
		question.question.title ?? "",
	);
	await expect(frame).toContainText("100");

	const keyTab = page.locator("astro-island [role=tab]").nth(1);
	await keyTab.click();
	await expect(keyTab).toHaveAttribute("aria-selected", "true");
	await expect(frame).toBeVisible();
});
