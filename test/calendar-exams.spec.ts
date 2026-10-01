import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { courseHref } from "@/urls";
import { localDateOf, SERVER_TZ } from "@/utils/schedule-time";
import { logInAs, resetDatabase, seedUser } from "./stories/helpers";

test.beforeEach(resetDatabase);

const DAY = 86_400_000;

/// "March 2026" for the month holding `date`, as the calendar heads its grid.
function monthLabel(date: Date): string {
	return new Intl.DateTimeFormat("en-US", {
		month: "long",
		year: "numeric",
		timeZone: SERVER_TZ,
	}).format(date);
}

test("an instructor sees the scheduled exams of the course they teach, drafts marked as such", async ({
	page,
}) => {
	const instructor = await seedUser({ role: "INSTRUCTOR" });
	const course = await persistedCourseFactory.create({
		instructor: instructor.username,
	});
	const scheduledAt = new Date(Date.now() + 3 * DAY);
	await persistedExamFactory.create({
		course: course.id,
		slug: "teach-midterm",
		title: "Teaching midterm",
		type: "EXAM",
		scheduledAt,
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "teach-draft",
		title: "Half-written final",
		status: "DRAFT",
		scheduledAt,
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, instructor);
	const dayKey = localDateOf(scheduledAt);
	await page.goto(`/calendar?month=${dayKey.slice(0, 7)}`);

	const row = page
		.locator(`#day-${dayKey}`)
		.getByRole("link", { name: /Teaching midterm/ });
	await expect(row).toContainText("Exam");
	await expect(row).toHaveAttribute("href", `${href}/exams/teach-midterm`);

	const draft = page
		.locator(`#day-${dayKey}`)
		.getByRole("link", { name: /Half-written final/ });
	await expect(draft).toContainText("Draft");
	await expect(draft).toHaveAttribute("href", `${href}/exams/teach-draft`);
});

test("the calendar opens on the next exam and pages up to it", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	const course = await persistedCourseFactory.create();
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	// Far enough to sit in another month than today's.
	const scheduledAt = new Date(Date.now() + 70 * DAY);
	await persistedExamFactory.create({
		course: course.id,
		slug: "far-exam",
		title: "Far-off exam",
		scheduledAt,
	});

	await logInAs(page, student);

	await test.step("with no events, the exam's month is the default", async () => {
		await page.goto("/calendar");
		await expect(page.getByText(monthLabel(scheduledAt))).toBeVisible();
		await expect(
			page.locator(`#day-${localDateOf(scheduledAt)}`),
		).toContainText("Far-off exam");
	});

	await test.step("paging stops at the exam's month", async () => {
		await expect(page.getByRole("link", { name: "Next month" })).toHaveCount(0);
		await expect(
			page.getByRole("link", { name: "Previous month" }),
		).toBeVisible();
	});
});
