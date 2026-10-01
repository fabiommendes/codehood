import { expect, test } from "@playwright/test";
import { FULL_ACCESS } from "@/auth/actor";
import { db } from "@/db";
import { persistedCalendarEventFactory } from "@/fixtures/calendar-event.factory";
import { persistedCourseFactory } from "@/fixtures/course.factory";
import { persistedExamFactory } from "@/fixtures/exam.factory";
import { persistedTimeSlotFactory } from "@/fixtures/time-slot.factory";
import { courseHref } from "@/urls";
import {
	futureDate,
	logInAs,
	resetDatabase,
	seedUser,
} from "./stories/helpers";

test.beforeEach(resetDatabase);

const DAY = 86_400_000;

test("the schedule folds the weeks already held and shows the exams among the meetings", async ({
	page,
}) => {
	const student = await seedUser({ role: "STUDENT" });
	// A term that began ten weeks ago.
	const course = await persistedCourseFactory.create({
		startAt: new Date(Date.now() - 70 * DAY),
		endAt: new Date(Date.now() + 70 * DAY),
	});
	await db.enrollment.create(
		{ course: course.id, username: student.username },
		FULL_ACCESS,
	);
	const slot = await persistedTimeSlotFactory.create({
		course: course.id,
		day: futureDate(0).day,
	});
	const first = await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 0,
		title: "First meeting",
	});
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 1,
		title: "Second meeting",
	});
	await persistedCalendarEventFactory.create({
		course: course.id,
		timeSlot: slot.id,
		week: 12,
		title: "Meeting ahead",
		description: "- Lists\n- Dictionaries",
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "quiz-ahead",
		title: "Quiz ahead",
		type: "QUIZ",
		scheduledAt: new Date(Date.now() + 20 * DAY),
	});
	await persistedExamFactory.create({
		course: course.id,
		slug: "final-draft",
		title: "Unfinished final",
		status: "DRAFT",
		scheduledAt: new Date(Date.now() + 30 * DAY),
	});
	const href = courseHref({
		discipline: course.discipline.slug,
		instructor: course.instructor.username,
		edition: course.edition.slug,
	});

	await logInAs(page, student);
	await page.goto(`${href}/schedule`);

	await test.step("the weeks already held are folded under one line", async () => {
		await expect(page.getByText("Weeks 0–1, already held")).toBeVisible();
		await expect(page.getByText("First meeting")).toBeHidden();
	});

	await test.step("the next meeting is marked and shows its lesson plan", async () => {
		const row = page.locator("li", { hasText: "Meeting ahead" });
		await expect(row.getByText("Next", { exact: true })).toBeVisible();
		await expect(row.getByRole("listitem")).toHaveText([
			"Lists",
			"Dictionaries",
		]);
	});

	await test.step("a dated exam sits in its week and leads to its page", async () => {
		const link = page.getByRole("link", { name: "Quiz ahead" });
		await expect(link).toHaveAttribute("href", `${href}/exams/quiz-ahead`);
		await expect(page.locator("#exam-quiz-ahead")).toContainText("Quiz");
	});

	await test.step("a student never sees a draft", async () => {
		await expect(page.getByText("Unfinished final")).toHaveCount(0);
	});

	await test.step("a link to a meeting in a past week unfolds it", async () => {
		await page.goto(`${href}/schedule#event-${first.id}`);
		await expect(page.getByText("First meeting")).toBeVisible();
	});
});
