import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { courseHref } from "@/urls";
import { expect, test } from "./fixtures";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

test("details opens on click, a comment stays hidden and XSS payloads do not run", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	await db.resource.create(
		{
			course: course.id,
			slug: "html-notes",
			title: "HTML notes",
			data: {
				type: "MD",
				content: [
					"Visible text.",
					"",
					"<!-- hidden-comment -->",
					"",
					"<details>",
					"<summary>More</summary>",
					"",
					"Expanded body.",
					"",
					"</details>",
					"",
					'<img src="x" onerror="window.pwned = 1">',
					"",
					"<script>window.pwned = 2</script>",
					"",
					'<a href="javascript:window.pwned = 3">click me</a>',
				].join("\n"),
			},
		},
		FULL_ACCESS,
	);
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});
	await logInAs(page, student);
	await page.goto(`${href}/resources/html-notes`);

	await expect(page.getByText("Visible text.")).toBeVisible();
	await expect(page.getByText("hidden-comment")).toHaveCount(0);
	await expect(page.getByText("Expanded body.")).toBeHidden();
	await page.getByText("More", { exact: true }).click();
	await expect(page.getByText("Expanded body.")).toBeVisible();

	await page.getByText("click me").click();
	expect(await page.evaluate(() => "pwned" in window)).toBe(false);
});
