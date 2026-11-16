import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedQuestionFactory } from "@/fixtures/question.factory";
import { courseHref } from "@/urls";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase } from "./stories/helpers";

test.beforeEach(resetDatabase);

test("the question page highlights the fenced blocks of the stem with Shiki, in both tabs", async ({
	page,
}) => {
	const course = await persistedCourseFactory.create();
	const question = await persistedQuestionFactory.create(
		{
			course: course.id,
			slug: "fenced-stem",
			question: {
				type: "multiple-choice",
				title: "Fenced stem",
				stem: "What does it print?\n\n```python\nprint(1 + 1)\n```",
				choices: [
					{ id: "two", text: "2", score: 1 },
					{ id: "eleven", text: "11" },
				],
			},
		},
		{ transient: { type: "multiple-choice" } },
	);
	await logInAs(page, course.instructor);
	await page.goto(
		`${courseHref({
			discipline: course.discipline.slug,
			instructor: course.instructor.username,
			edition: course.edition.slug,
		})}/questions/${question.slug}`,
	);

	const frame = page.locator("section#question-1");
	const block = frame.locator(".mdq-markdown pre.shiki");
	await expect(block).toHaveCount(1);
	await expect(block).toContainText("print(1 + 1)");
	await expect(
		block.locator('span[style*="--shiki-light"]').first(),
	).toBeVisible();
	await expect(frame.locator(".mdq-markdown code.language-python")).toHaveCount(
		0,
	);

	// The key tab renders the stem again in the browser, from the island's props.
	const keyTab = page.locator("astro-island [role=tab]").nth(1);
	await keyTab.click();
	await expect(keyTab).toHaveAttribute("aria-selected", "true");
	await expect(frame.locator(".mdq-markdown pre.shiki")).toHaveCount(1);
	await expect(
		frame
			.locator('.mdq-markdown pre.shiki span[style*="--shiki-dark"]')
			.first(),
	).toBeVisible();
});
